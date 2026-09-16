const { pgPool } = require('../config/db');
const { assertCoordOwnsEvent } = require('../services/coordAuth');

/* Attendance for a specific EVENT (possibly spanning several days), scoped to
   every active member of the club that organized it — distinct from
   club_attendance_sessions/records in clubDetail.controller.js, which track
   general club-meeting attendance, not a specific event. */
(async () => {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_attendance_sessions (
        id            BIGSERIAL     PRIMARY KEY,
        event_id      BIGINT        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        session_date  DATE          NOT NULL,
        session_label VARCHAR(255)  NOT NULL DEFAULT '',
        created_by    INTEGER       REFERENCES users(id),
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, session_date)
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_attendance_records (
        id          BIGSERIAL     PRIMARY KEY,
        session_id  BIGINT        NOT NULL REFERENCES event_attendance_sessions(id) ON DELETE CASCADE,
        user_id     INTEGER       REFERENCES users(id) ON DELETE CASCADE,
        user_name   VARCHAR(255)  NOT NULL DEFAULT '',
        status      VARCHAR(20)   NOT NULL DEFAULT 'present',
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, user_id)
      )
    `);
    /* Registrants without a users account (public event/team-roster registration never
       required one) still need to be attendance-markable, so user_id was relaxed to
       nullable above and every record can instead anchor to the event_registrations row
       — one or the other is always set, enforced in the controller, not the schema. */
    await pgPool.query(`ALTER TABLE event_attendance_records ALTER COLUMN user_id DROP NOT NULL`);
    await pgPool.query(`ALTER TABLE event_attendance_records ADD COLUMN IF NOT EXISTS registration_id BIGINT REFERENCES event_registrations(id) ON DELETE CASCADE`);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_attend_rec_session_reg ON event_attendance_records(session_id, registration_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_sess_event   ON event_attendance_sessions(event_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_rec_session ON event_attendance_records(session_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_rec_user    ON event_attendance_records(user_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_rec_reg     ON event_attendance_records(registration_id)`);
    console.log('[eventAttendance] migrations ready');
  } catch (err) {
    console.error('[eventAttendance] migration failed:', err.message);
  }
})();

/* Verify this coordinator (or admin) has access to the event — mirrors
   certificates.controller.js / eventTeams.controller.js's checkAccess. */
const checkAccess = async (req, res) => {
  if (req.user.role === 'admin') return true;
  const ok = await assertCoordOwnsEvent(req.user.id, req.params.id);
  if (!ok) {
    res.status(403).json({ message: 'You do not have access to this event.' });
    return false;
  }
  return true;
};

/* GET /api/events/:id/attendance
   Returns the full roster to record against — every active club member PLUS
   EVERY registrant for this event (Sports Fiesta captain + teammates included),
   whether or not they belong to the club or even have a users account — every
   attendance day declared for this event so far, and the recorded status for
   each (member, day) pair. The frontend renders this as a grid.

   Each roster row carries `id` (a real users.id, when the registrant's email
   matches an account) and/or `registrationId` (the event_registrations row).
   A registrant with a matching account is keyed by `id` — same as before, and
   what makes their attendance show up on the public "My Activity" page (see
   activityByEmail in users.controller.js). A registrant with no account (most
   Sports Fiesta teammates, or anyone who registered without ever signing up)
   is keyed by `registrationId` alone — still fully markable, just not
   attributable to an account, so it won't surface on that student's own
   "My Activity" lookup since there's no account/email of theirs to match it
   against. */
const getAttendance = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;

    const { rows: evRows } = await pgPool.query(
      `SELECT id, club_id, title FROM events WHERE id = $1`, [req.params.id]
    );
    if (!evRows.length) return res.status(404).json({ message: 'Event not found.' });
    const clubId = evRows[0].club_id;

    const [{ rows: clubMembers }, { rows: regs }, { rows: sessions }, { rows: records }] = await Promise.all([
      clubId
        ? pgPool.query(
            `SELECT u.id, u.name, u.email
             FROM student_clubs sc
             JOIN users u ON u.id = sc.user_id AND u.is_active = true
             WHERE sc.club_id = $1 AND sc.is_active = true
             ORDER BY u.name`,
            [clubId]
          )
        : Promise.resolve({ rows: [] }),
      pgPool.query(
        `SELECT id, name, email FROM event_registrations WHERE event_id = $1 ORDER BY registered_at ASC`,
        [req.params.id]
      ),
      pgPool.query(
        `SELECT id, session_date, session_label, created_at
         FROM event_attendance_sessions
         WHERE event_id = $1
         ORDER BY session_date ASC`,
        [req.params.id]
      ),
      pgPool.query(
        `SELECT r.session_id, r.user_id, r.registration_id, r.status
         FROM event_attendance_records r
         JOIN event_attendance_sessions s ON s.id = r.session_id
         WHERE s.event_id = $1`,
        [req.params.id]
      ),
    ]);

    const regEmails = [...new Set(
      regs.map(r => r.email.toLowerCase()).filter(e => !e.endsWith('@roster.internal'))
    )];
    const { rows: matchedUsers } = regEmails.length
      ? await pgPool.query(
          `SELECT id, LOWER(email) AS email FROM users WHERE is_active = true AND LOWER(email) = ANY($1::text[])`,
          [regEmails]
        )
      : { rows: [] };
    const userIdByEmail = new Map(matchedUsers.map(u => [u.email, u.id]));

    const roster = new Map(); // `u:<id>` or `r:<registrationId>` -> row
    for (const m of clubMembers) {
      roster.set(`u:${m.id}`, { id: m.id, registrationId: null, name: m.name, email: m.email });
    }
    for (const r of regs) {
      const emailLower = r.email.toLowerCase();
      const isPlaceholder = emailLower.endsWith('@roster.internal');
      const matchedUserId = isPlaceholder ? null : userIdByEmail.get(emailLower);
      if (matchedUserId) {
        const key = `u:${matchedUserId}`;
        const existing = roster.get(key);
        if (existing) existing.registrationId = existing.registrationId ?? r.id;
        else roster.set(key, { id: matchedUserId, registrationId: r.id, name: r.name, email: r.email });
      } else {
        roster.set(`r:${r.id}`, { id: null, registrationId: r.id, name: r.name, email: isPlaceholder ? null : r.email });
      }
    }
    const members = [...roster.values()].sort((a, b) => a.name.localeCompare(b.name));

    res.json({ members, sessions, records });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/attendance/sessions  { date, label }
   Adds (or renames, if the date already exists) one attendance day. */
const createSession = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { date, label } = req.body;
    if (!date) return res.status(400).json({ message: 'date is required.' });

    const { rows } = await pgPool.query(
      `INSERT INTO event_attendance_sessions (event_id, session_date, session_label, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, session_date) DO UPDATE SET session_label = EXCLUDED.session_label
       RETURNING id, session_date, session_label, created_at`,
      [req.params.id, date, (label || '').trim(), req.user.id]
    );
    res.status(201).json({ session: rows[0] });
  } catch (err) { next(err); }
};

/* DELETE /api/events/:id/attendance/sessions/:sessionId */
const deleteSession = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { rowCount } = await pgPool.query(
      `DELETE FROM event_attendance_sessions WHERE id = $1 AND event_id = $2`,
      [req.params.sessionId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Session not found.' });
    res.json({ message: 'Attendance day removed.' });
  } catch (err) { next(err); }
};

/* PATCH /api/events/:id/attendance/sessions/:sessionId
   body: { records: [{ userId?, registrationId?, userName, status: 'present'|'absent' }] }
   Bulk-upserts every listed roster row's status for this day in one statement
   per identity type — a row is keyed by userId when the registrant has a
   matching account, else by registrationId (see getAttendance above). */
const recordAttendance = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { records = [] } = req.body;
    const clean = records.filter(r => (r.userId || r.registrationId) && ['present', 'absent'].includes(r.status));
    if (!clean.length) return res.status(400).json({ message: 'records array is required.' });

    const { rows: sessRows } = await pgPool.query(
      `SELECT id FROM event_attendance_sessions WHERE id = $1 AND event_id = $2`,
      [req.params.sessionId, req.params.id]
    );
    if (!sessRows.length) return res.status(404).json({ message: 'Attendance day not found.' });

    const withUser = clean.filter(r => r.userId);
    const withReg  = clean.filter(r => !r.userId && r.registrationId);

    if (withUser.length) {
      await pgPool.query(
        `INSERT INTO event_attendance_records (session_id, user_id, user_name, status)
         SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::text[])
         ON CONFLICT (session_id, user_id) DO UPDATE
           SET status = EXCLUDED.status, user_name = EXCLUDED.user_name, updated_at = NOW()`,
        [req.params.sessionId, withUser.map(r => r.userId), withUser.map(r => r.userName || ''), withUser.map(r => r.status)]
      );
    }
    if (withReg.length) {
      await pgPool.query(
        `INSERT INTO event_attendance_records (session_id, registration_id, user_name, status)
         SELECT $1, unnest($2::bigint[]), unnest($3::text[]), unnest($4::text[])
         ON CONFLICT (session_id, registration_id) DO UPDATE
           SET status = EXCLUDED.status, user_name = EXCLUDED.user_name, updated_at = NOW()`,
        [req.params.sessionId, withReg.map(r => r.registrationId), withReg.map(r => r.userName || ''), withReg.map(r => r.status)]
      );
    }
    res.json({ message: 'Attendance saved.' });
  } catch (err) { next(err); }
};

module.exports = { getAttendance, createSession, deleteSession, recordAttendance };
