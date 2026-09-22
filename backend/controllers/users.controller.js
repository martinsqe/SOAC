const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const { pgPool } = require('../config/db');
const { cloudinaryInstance, useCloudinary } = require('../config/multer');
const { ensureSoacTables } = require('../services/soacData');
const { sendCredentials, sendActivityReport } = require('../config/email');
const { notifyUser } = require('../services/notify');
const cache = require('../services/cache');
const { syncPastEvents } = require('../services/eventStatus');

const AVATAR_ALLOWED = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/* Upload a file buffer — returns stored value (Cloudinary URL or /uploads path) */
const uploadAvatarBuffer = async (file) => {
  if (useCloudinary && cloudinaryInstance) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinaryInstance.uploader.upload_stream(
        { folder: 'avatars', resource_type: 'image', allowed_formats: AVATAR_ALLOWED },
        (err, r) => (err ? reject(err) : resolve(r))
      );
      stream.end(file.buffer);
    });
    return result.secure_url;
  }
  // Disk fallback
  const dir = path.join(__dirname, '..', 'uploads', 'avatars');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  fs.writeFileSync(path.join(dir, fname), file.buffer);
  return `/uploads/avatars/${fname}`;
};

const RKU_DOMAIN = '@rku.ac.in';

/* ── Column list for user rows returned to clients (never exposes password_hash) */
const USER_PUBLIC_COLS = [
  'id', 'email', 'name', 'role', 'is_active',
  'must_change_password', 'managed_club_id', 'created_at', 'last_login',
].join(', ');

/* ── Pagination helper ──────────────────────────────────────────────────────*/
const parsePage = (query) => {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
};

/* GET /api/users  (admin)
   Supports ?page=&limit=
   Includes each student's active club memberships (name + id) — students can belong to up
   to 3 clubs at once, so this is an array, not a single value like coordinators' managed_club_id. */
const getAll = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const { rows } = await pgPool.query(
      `SELECT u.id, u.email, u.name, u.role, u.is_active,
              u.must_change_password, u.managed_club_id, u.created_at, u.last_login,
              COALESCE(profile.phone,  '') AS phone,
              COALESCE(profile.gender, '') AS gender,
              COALESCE(
                json_agg(jsonb_build_object('id', sc.club_id, 'name', sc.club_name))
                  FILTER (WHERE sc.id IS NOT NULL),
                '[]'
              ) AS clubs,
              COUNT(*) OVER() AS total_count
       FROM users u
       LEFT JOIN student_clubs sc ON sc.user_id = u.id AND sc.is_active = true
       /* Phone/gender as registered on any of this account's join requests —
          same "student profile fact, not membership fact" lookup used by
          GET /clubs/members, so the same values show here regardless of
          which club (if any) they were originally submitted for. Coordinators/
          admins simply have no join_requests row, so both stay blank for
          them, which is correct — they never filled out that form. */
       LEFT JOIN LATERAL (
         SELECT phone, gender
         FROM   join_requests
         WHERE  email = u.email
         ORDER BY (status = 'approved') DESC, updated_at DESC
         LIMIT 1
       ) profile ON true
       GROUP BY u.id, profile.phone, profile.gender
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      users:      rows.map(({ total_count, ...u }) => u),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* POST /api/users  (admin — create user and email credentials) */
const create = async (req, res, next) => {
  try {
    const { email, name, role = 'admin' } = req.body;
    if (!email || !name)              return res.status(400).json({ message: 'Email and name are required.' });
    if (!email.endsWith(RKU_DOMAIN))  return res.status(400).json({ message: 'Only @rku.ac.in emails are allowed.' });

    const tempPassword = crypto.randomBytes(5).toString('hex').toUpperCase();
    const hash         = await bcrypt.hash(tempPassword, 12);

    const { rows } = await pgPool.query(
      `INSERT INTO users (email, password_hash, name, role, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, is_active, must_change_password, created_at`,
      [email.toLowerCase(), hash, name, role, req.user.id]
    );
    const newUser = rows[0];

    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, 'CREATE_USER', 'user', $3, $4)`,
      [req.user.id, req.user.name, String(newUser.id), JSON.stringify({ email, role })]
    );

    sendCredentials({ toEmail: email, toName: name, password: tempPassword })
      .catch(err => console.warn('Email send failed:', err.message));

    await cache.del('stats:admin');
    res.status(201).json({ user: newUser, tempPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'A user with that email already exists.' });
    next(err);
  }
};

/* PUT /api/users/:id  (admin) */
const update = async (req, res, next) => {
  try {
    const { name, role, is_active } = req.body;
    if (is_active === false && Number(req.params.id) === req.user.id) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }
    const { rows } = await pgPool.query(
      `UPDATE users
       SET name      = COALESCE($1, name),
           role      = COALESCE($2, role),
           is_active = COALESCE($3, is_active)
       WHERE id = $4
       RETURNING id, email, name, role, is_active`,
      [name, role, is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });
    await cache.del(`session:user:${req.params.id}`);
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
};

/* DELETE /api/users/:id  (admin — permanently delete this account)
   Distinct from PUT /:id { is_active:false } (Deactivate — reversible, keeps the
   account and every record it's attached to). This actually removes the row.
   Everything ON DELETE CASCADE to users(id) — their own auth tokens, messages,
   club/event registrations, tasks and announcements they authored, attendance
   and performance records recorded against them, event requests they
   submitted, etc. — is removed by the database along with them, exactly as it
   would be for any DELETE FROM users. Every OTHER column that references a
   user (mostly "who did this" on someone else's data — an audit log entry, an
   attendance session, a progress note, an account they created) is discovered
   at runtime from the database's own foreign-key metadata, rather than a
   hand-maintained list here that a future schema change could silently fall
   out of sync with — a mismatch there is exactly what would abort the
   transaction and, if left unhandled, poison the pooled connection for
   whatever unrelated request reuses it next. Each column is detached inside
   its own SAVEPOINT so one unexpectedly NOT NULL or already-removed column
   can't take the rest of the deletion down with it. */
const detachUserReferences = async (client, userId) => {
  const { rows: fkCols } = await client.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name AND rc.constraint_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND ccu.table_name = 'users' AND ccu.column_name = 'id'
      AND rc.delete_rule NOT IN ('CASCADE', 'SET NULL')
  `);

  for (const { table_name: table, column_name: column } of fkCols) {
    await client.query('SAVEPOINT detach_step');
    try {
      await client.query(`UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" = $1`, [userId]);
      await client.query('RELEASE SAVEPOINT detach_step');
    } catch (e) {
      /* Column turned out to be NOT NULL (or something else went wrong on this one
         table) — recover to a clean state, then just remove those rows instead of
         leaving the deletion blocked on data that's about to lose its owner anyway. */
      await client.query('ROLLBACK TO SAVEPOINT detach_step');
      await client.query('RELEASE SAVEPOINT detach_step');
      await client.query(`DELETE FROM "${table}" WHERE "${column}" = $1`, [userId]);
    }
  }
};

const remove = async (req, res, next) => {
  const client = await pgPool.connect();
  let dbOk = true; // false once anything on this connection fails in a way ROLLBACK can't clear
  try {
    const userId = Number(req.params.id);
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }
    const { rows } = await pgPool.query(`SELECT id, name, email, role FROM users WHERE id = $1`, [userId]);
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });
    const target = rows[0];

    await client.query('BEGIN');
    await detachUserReferences(client, userId);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query('COMMIT');

    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, 'DELETE_USER', 'user', $3, $4)`,
      [req.user.id, req.user.name, String(userId), JSON.stringify({ name: target.name, email: target.email, role: target.role })]
    );

    await Promise.all([
      cache.del('stats:admin'),
      cache.del(`session:user:${userId}`),
      cache.del(`session:tokens:${userId}`),
      cache.delPattern('clubs:*'),
    ]);
    res.json({ message: `${target.name} was permanently deleted.` });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      /* The connection itself is no longer trustworthy — releasing it normally would
         hand a broken, still-mid-transaction connection to pg-pool, which would then
         fail every query some later, unrelated request happens to draw it for with
         this same "current transaction is aborted" error. Force pg-pool to close and
         discard it instead of returning it to the pool. */
      dbOk = false;
      console.error('[users.remove] rollback failed, discarding connection:', rollbackErr.message);
    }
    next(err);
  } finally {
    client.release(!dbOk);
  }
};

/* GET /api/users/meta/stats  (admin)
   8 counts run in parallel via Promise.all — no sequential round-trips.
   Cache-aside: stats:admin → 30 s */
const stats = async (req, res, next) => {
  try {
    await ensureSoacTables();
    await syncPastEvents();

    const cached = await cache.get('stats:admin');
    if (cached) return res.json(cached);

    const [usersRes, auditRes, clubsRes, eventsRes, upcomingRes, regsRes, pendingReqRes, studentsRes] = await Promise.all([
      pgPool.query(`SELECT COUNT(*)::int AS count FROM users        WHERE is_active = true`),
      pgPool.query(`SELECT user_name, action, entity_type, entity_id, meta, created_at
                    FROM audit_log ORDER BY created_at DESC LIMIT 10`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM clubs        WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM events       WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM events       WHERE is_active = true AND status = 'upcoming'`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM event_registrations`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM join_requests WHERE status = 'pending'`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM users        WHERE role = 'student' AND is_active = true`),
    ]);

    const result = {
      clubs:           clubsRes.rows[0].count,
      events:          eventsRes.rows[0].count,
      upcomingEvents:  upcomingRes.rows[0].count,
      registrations:   regsRes.rows[0].count,
      pendingRequests: pendingReqRes.rows[0].count,
      students:        studentsRes.rows[0].count,
      users:           usersRes.rows[0].count,
      recentAudit:     auditRes.rows,
      mongoReady:      false,
    };
    await cache.set('stats:admin', result, cache.TTL.STATS);
    res.json(result);
  } catch (err) { next(err); }
};

/* GET /api/users/meta/audit  (admin)
   Supports ?page=&limit= — previously hard-capped at 100 rows */
const auditLog = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const { rows } = await pgPool.query(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, meta, created_at,
              COUNT(*) OVER() AS total_count
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      log:        rows.map(({ total_count, ...r }) => r),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* GET /api/users/me/clubs  (student)
   Cache-aside: student:<id> → 60 s */
const myClubs = async (req, res, next) => {
  try {
    const cacheKey = `student:${req.user.id}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    /* Only memberships that are actually live: still active (a coordinator can
       deactivate one without deleting it, and a deactivated slot no longer counts
       toward the 3-club cap) and pointing at a club that still exists and is active
       (stale rows can outlive a re-created or removed club). Everything that shows
       "your clubs" reads this, so it has to match what really counts. */
    const { rows } = await pgPool.query(
      `SELECT sc.club_id, c.name AS club_name, sc.joined_at
       FROM student_clubs sc
       JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE sc.user_id = $1 AND sc.is_active = true
       ORDER BY sc.joined_at`,
      [req.user.id]
    );
    const result = { clubs: rows };
    await cache.set(cacheKey, result, cache.TTL.STUDENT);
    res.json(result);
  } catch (err) { next(err); }
};

/* GET /api/users/me/event-registrations  (any authenticated student)
   Server-truth registration status (by email) for every event this student has ever
   registered for — regardless of which device/session/localStorage state that
   happened in. This is what lets the events page correctly show "already registered"
   for a student who, say, registered for a club's event before joining that club,
   then logs in later (possibly on a different device) after joining — the frontend
   no longer has to rely on localStorage alone to know this. */
const myEventRegistrations = async (req, res, next) => {
  try {
    const email = (req.user?.email || '').toLowerCase();
    if (!email) return res.json({ registrations: [] });

    const { rows } = await pgPool.query(
      `SELECT er.event_id, er.id AS registration_id,
              et.name AS team_name, et.is_cleared
       FROM event_registrations er
       LEFT JOIN event_team_members etm ON etm.registration_id = er.id
       LEFT JOIN event_teams et ON et.id = etm.team_id
       WHERE LOWER(er.email) = $1
       ORDER BY er.registered_at ASC`,
      [email]
    );

    const byEvent = {};
    for (const r of rows) {
      const key = String(r.event_id);
      if (!byEvent[key]) {
        byEvent[key] = {
          eventId:  key,
          status:   r.is_cleared ? 'cleared' : r.team_name ? 'team_assigned' : 'registered',
          teamName: r.team_name || null,
        };
      }
    }
    res.json({ registrations: Object.values(byEvent) });
  } catch (err) { next(err); }
};

/* The platform's 8 event categories (see AdminEvents.jsx's CAT_LABEL) bucketed into
   the 4 top-level groups the "My Activity" public page shows as tabs. */
const ACTIVITY_BUCKET = {
  sports: 'sports',
  cultural: 'cultural', 'annual-fest': 'cultural',
  community: 'social', leadership: 'social',
  tech: 'academic', health: 'academic', general: 'academic',
};
const ACTIVITY_BUCKET_LABEL = { sports: 'Sports', cultural: 'Cultural', social: 'Social', academic: 'Academic' };

/* Everything the "My Activity" views show for one email: club status, the events they
   registered for (grouped into the four categories) with attendance and any certificate
   they earned there, and their overall event attendance. Looked up directly against
   event_registrations rather than requiring a users account, since public event and
   team-roster registration never required one. Shared by the public lookup and the
   student's own dashboard so the two can never drift apart. */
const buildActivity = async (email) => {
  /* Club status for this email — returned whether or not they've registered for
     any events, since a student can have a pending/approved join request and no
     event history at all. Latest request per club wins (a declined request can
     later be re-submitted and approved). An approved request only counts as
     "member" while the student_clubs row is still active — a coordinator can
     deactivate a membership without deleting it. Memberships that never went
     through a join request (e.g. admin-assigned) are included too. */
  const [{ rows: reqRows }, { rows: memberRows }] = await Promise.all([
    pgPool.query(
      `SELECT DISTINCT ON (jr.club_id)
              jr.club_id, COALESCE(c.name, jr.club_name) AS club_name,
              jr.status, jr.created_at AS requested_at
       FROM join_requests jr
       LEFT JOIN clubs c ON c.id = jr.club_id
       WHERE LOWER(jr.email) = $1
       ORDER BY jr.club_id, jr.created_at DESC`,
      [email]
    ),
    pgPool.query(
      `SELECT sc.club_id, COALESCE(c.name, sc.club_name) AS club_name,
              sc.is_active, sc.joined_at
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       LEFT JOIN clubs c ON c.id = sc.club_id
       WHERE LOWER(u.email) = $1`,
      [email]
    ),
  ]);
  const memberByClub = new Map(memberRows.map(m => [String(m.club_id), m]));
  const clubMap = new Map();
  for (const r of reqRows) {
    const m = memberByClub.get(String(r.club_id));
    const status =
      r.status === 'pending'  ? 'pending' :
      r.status === 'declined' ? 'declined' :
      (m && m.is_active === false) ? 'inactive' : 'member';
    clubMap.set(String(r.club_id), {
      clubId: String(r.club_id), clubName: r.club_name, status, requestedAt: r.requested_at,
    });
  }
  for (const m of memberRows) {
    if (!clubMap.has(String(m.club_id))) {
      clubMap.set(String(m.club_id), {
        clubId: String(m.club_id), clubName: m.club_name,
        status: m.is_active === false ? 'inactive' : 'member', requestedAt: m.joined_at,
      });
    }
  }
  /* Collapse entries that share a club name (stale membership rows can point at
     old club ids that no longer exist but carry the same stored name) — keep the
     strongest status so a student never sees the same club listed twice. */
  const STATUS_RANK = { member: 0, pending: 1, inactive: 2, declined: 3 };
  const byName = new Map();
  for (const c of clubMap.values()) {
    const key = (c.clubName || '').trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing || STATUS_RANK[c.status] < STATUS_RANK[existing.status]) byName.set(key, c);
  }
  const clubs = [...byName.values()]
    .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

  const { rows: regRows } = await pgPool.query(
    /* start_date (a proper TIMESTAMPTZ, set once at event creation/approval and
       never hand-typed) is used for the displayed event date rather than the
       `date` column — that one's a free-text label an admin can type anything
       into ("Feb 2-8, 2027", or nothing at all), so it can't be parsed or
       trusted to render correctly here. */
    `SELECT er.id AS registration_id, er.event_id, er.event_title, er.registered_at,
            e.start_date AS event_date, e.venue, e.category,
            c.name AS club_name
     FROM event_registrations er
     LEFT JOIN events e ON e.id = er.event_id
     LEFT JOIN clubs c ON c.id = e.club_id
     WHERE LOWER(er.email) = $1
     ORDER BY er.registered_at DESC`,
    [email]
  );

  if (!regRows.length) {
    return { participated: false, clubs };
  }

  const { rows: uRows } = await pgPool.query(
    `SELECT id, name FROM users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
    [email]
  );
  const userId  = uRows[0]?.id   || null;
  const regIds  = regRows.map(r => r.registration_id);
  const eventIds = [...new Set(regRows.map(r => r.event_id))];

  const [certRes, attendRes] = await Promise.all([
    pgPool.query(
      `SELECT registration_id, event_id, category, file_url, delivery_method
       FROM event_certificates_issued WHERE registration_id = ANY($1::int[])`,
      [regIds]
    ),
    /* Matches a mark left against either identity a coordinator could have recorded
       it under (see eventAttendance.controller.js's getAttendance/recordAttendance):
       user_id when this email has a matching account, or registration_id directly
       (registration_id is globally unique and already scoped to one event via its
       own FK, so matching it here needs no extra event_id check) when it doesn't —
       so attendance shows up here even for a registrant with no account at all. */
    pgPool.query(
      `SELECT s.event_id,
              COUNT(DISTINCT s.id) AS total_sessions,
              COUNT(DISTINCT CASE WHEN r.status = 'present' THEN s.id END) AS present_sessions
       FROM event_attendance_sessions s
       LEFT JOIN event_attendance_records r ON r.session_id = s.id
         AND (r.user_id = $2 OR r.registration_id = ANY($3::bigint[]))
       WHERE s.event_id = ANY($1::int[])
       GROUP BY s.event_id`,
      [eventIds, userId, regIds]
    ),
  ]);

  const attendByEvent = new Map(attendRes.rows.map(a => [String(a.event_id), a]));

  /* Overall event attendance = the average of the per-event percentages, across
     every event (from any club) that actually ran attendance sessions. Includes
     events they were marked present at without ever registering — a coordinator
     can mark a member present by account — which the registration list above
     can't see. Only possible when this email has an account to match marks to. */
  const attendedOnly = userId ? (await pgPool.query(
    `SELECT s.event_id,
            (SELECT COUNT(*) FROM event_attendance_sessions s2 WHERE s2.event_id = s.event_id)::int AS total_sessions,
            COUNT(DISTINCT s.id)::int AS present_sessions
     FROM event_attendance_sessions s
     JOIN event_attendance_records r ON r.session_id = s.id AND r.user_id = $2 AND r.status = 'present'
     WHERE NOT (s.event_id = ANY($1::bigint[]))
     GROUP BY s.event_id`,
    [eventIds, userId]
  )).rows : [];
  const eventFractions = [
    ...attendRes.rows.map(a => [Number(a.present_sessions), Number(a.total_sessions)]),
    ...attendedOnly.map(a => [a.present_sessions, a.total_sessions]),
  ].filter(([, total]) => total > 0).map(([present, total]) => present / total);
  const attendanceSummary = {
    averagePct: eventFractions.length
      ? Math.round((eventFractions.reduce((sum, f) => sum + f, 0) / eventFractions.length) * 100)
      : null,
    eventsCounted: eventFractions.length,
  };

  const certsByReg    = new Map();
  for (const c of certRes.rows) {
    if (!certsByReg.has(c.registration_id)) certsByReg.set(c.registration_id, []);
    certsByReg.get(c.registration_id).push(c);
  }

  const categories = { sports: [], cultural: [], social: [], academic: [] };
  for (const r of regRows) {
    const bucket = ACTIVITY_BUCKET[r.category] || 'academic';
    const a = attendByEvent.get(String(r.event_id));
    const total   = Number(a?.total_sessions   || 0);
    const present = Number(a?.present_sessions || 0);

    categories[bucket].push({
      eventId:      r.event_id,
      eventTitle:   r.event_title,
      clubName:     r.club_name || '—',
      category:     r.category || '',
      venue:        r.venue || '',
      eventDate:    r.event_date,
      registeredAt: r.registered_at,
      attendance: total > 0 ? { totalSessions: total, presentSessions: present, percentage: Math.round((present / total) * 100) } : null,
      achievements: (certsByReg.get(r.registration_id) || []).map(c2 => ({
        category: c2.category, fileUrl: c2.file_url, status: c2.delivery_method,
      })),
    });
  }

  return {
    participated: true,
    hasAccount: !!userId,
    clubs,
    attendanceSummary,
    categories: Object.entries(categories).map(([key, events]) => ({
      key, label: ACTIVITY_BUCKET_LABEL[key], events,
    })),
  };
};

/* Best-effort display name for the activity-report email's greeting — tries a real
   account first, then the name given on a club join request, then the name given at
   event registration, and finally falls back to the email's own local part so the
   greeting is never blank. */
const resolveActivityEmailName = async (email) => {
  const { rows: u } = await pgPool.query(
    `SELECT name FROM users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`, [email]
  );
  if (u[0]?.name) return u[0].name;
  const { rows: jr } = await pgPool.query(
    `SELECT name FROM join_requests WHERE LOWER(email) = $1 ORDER BY created_at DESC LIMIT 1`, [email]
  );
  if (jr[0]?.name) return jr[0].name;
  const { rows: er } = await pgPool.query(
    `SELECT name FROM event_registrations WHERE LOWER(email) = $1 ORDER BY registered_at DESC LIMIT 1`, [email]
  );
  if (er[0]?.name) return er[0].name;
  return email.split('@')[0];
};

/* GET /api/users/activity-by-email — public, no login required. Lets a student who
   isn't a club member (and so has no dashboard of their own) look up their participation
   history across every category by just entering the email they registered events with.
   Rather than rendering the result on the page, this mails it to that address — so a
   full lookup requires actually owning the inbox — and is capped at one send per email
   per rolling 24h. A repeat request inside that window gets a short message instead of
   another email; an email with nothing on record at all (no club, never registered,
   never participated) gets the same empty-state response as before and never touches
   the rate limit, since nothing was sent. */
const activityByEmail = async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@roster.internal')) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!email.endsWith('@rku.ac.in')) {
      return res.status(400).json({ message: 'Only @rku.ac.in emails are allowed.' });
    }

    await ensureSoacTables();
    const { rows: rl } = await pgPool.query(
      `SELECT 1 FROM activity_email_requests WHERE email = $1 AND last_sent_at > NOW() - INTERVAL '1 day'`,
      [email]
    );
    if (rl.length) {
      return res.json({ alreadySent: true, message: 'Your activity has already been sent to your email.' });
    }

    const data = await buildActivity(email);
    if (!data.participated && !data.clubs?.length) {
      return res.json(data);
    }

    /* Stamp the rate limit only AFTER a successful send — if the mail provider
       throws (both providers down, transient DNS failure, etc.) the student must
       not be locked out for a day over an email that never actually went out. */
    const toName = await resolveActivityEmailName(email);
    await sendActivityReport({
      toEmail: email, toName,
      clubs: data.clubs, attendanceSummary: data.attendanceSummary, categories: data.categories,
    });
    await pgPool.query(
      `INSERT INTO activity_email_requests (email, last_sent_at) VALUES ($1, NOW())
       ON CONFLICT (email) DO UPDATE SET last_sent_at = NOW()`,
      [email]
    );

    res.json({ emailed: true, message: 'Your activity has been sent to your email.' });
  } catch (err) { next(err); }
};

/* GET /api/users/me/activity — the logged-in student's own activity, same shape as the
   public lookup but always for their own account email, never one supplied by the caller. */
const myActivity = async (req, res, next) => {
  try {
    res.json(await buildActivity(String(req.user.email).trim().toLowerCase()));
  } catch (err) { next(err); }
};

function computeOverallScore(presentSessions, totalSessions, completedTasks, totalTasks) {
  let score = 0, weight = 0;
  if (totalSessions > 0) {
    score  += (presentSessions / totalSessions) * 100 * 0.6;
    weight += 0.6;
  }
  if (totalTasks > 0) {
    score  += (completedTasks / totalTasks) * 100 * 0.4;
    weight += 0.4;
  }
  if (weight === 0) return null;
  return Math.round(weight < 1 ? score / weight : score);
}

function scoreToLabel(score) {
  if (score === null) return { label: 'No data', color: '#9ca3af' };
  if (score >= 90)   return { label: 'Outstanding', color: '#059669' };
  if (score >= 75)   return { label: 'Excellent',   color: '#3b82f6' };
  if (score >= 60)   return { label: 'Good',         color: '#8b5cf6' };
  if (score >= 40)   return { label: 'Average',      color: '#f59e0b' };
  return               { label: 'Improving',    color: '#ef4444' };
}

/* ── Date-range helpers for period-based evaluation ────────────────────── */
function evalFmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function evalGetRange(period, dateStr) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const y = base.getFullYear(), mo = base.getMonth(), dy = base.getDate();
  switch (period) {
    case 'day': { const s = evalFmtDate(base); return { start: s, end: s }; }
    case 'week': {
      const dow = (base.getDay() + 6) % 7;
      const mon = new Date(base); mon.setDate(dy - dow);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: evalFmtDate(mon), end: evalFmtDate(sun) };
    }
    case 'month': {
      const first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
      return { start: evalFmtDate(first), end: evalFmtDate(last) };
    }
    case 'year':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    default: {
      const dow = (base.getDay() + 6) % 7;
      const mon = new Date(base); mon.setDate(dy - dow);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: evalFmtDate(mon), end: evalFmtDate(sun) };
    }
  }
}

/* GET /api/users/me/weekly-evaluation?period=week&date=2026-06-28
   Returns the student's per-club progress (attendance + tasks) for the
   requested period.                                                      */
const weeklyEvaluation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'week';
    const range  = evalGetRange(period, req.query.date);

    /* All clubs the user belongs to */
    const { rows: clubs } = await pgPool.query(
      `SELECT sc.club_id, c.name AS club_name, c.color
       FROM student_clubs sc
       JOIN clubs c ON c.id = sc.club_id
       WHERE sc.user_id = $1 AND c.is_active = true
       ORDER BY c.name`,
      [userId]
    );

    if (!clubs.length) {
      return res.json({ period, dateRange: range, clubs: [] });
    }

    const clubIds = clubs.map(c => c.club_id);

    /* Attendance records in period */
    const { rows: records } = await pgPool.query(
      `SELECT r.club_id, r.session_date, r.status, r.notes,
              COALESCE(s.session_label, '') AS session_label
       FROM club_attendance_records r
       LEFT JOIN club_attendance_sessions s ON s.id = r.session_id
       WHERE r.user_id = $1
         AND r.club_id = ANY($2::bigint[])
         AND r.session_date BETWEEN $3::date AND $4::date
       ORDER BY r.session_date ASC`,
      [userId, clubIds, range.start, range.end]
    );

    /* Task completion records in period */
    const { rows: taskRecs } = await pgPool.query(
      `SELECT club_id, task_title, is_completed,
              saved_at::date AS completed_date
       FROM task_completion_records
       WHERE user_id = $1
         AND club_id = ANY($2::bigint[])
         AND saved_at::date BETWEEN $3::date AND $4::date
       ORDER BY saved_at ASC`,
      [userId, clubIds, range.start, range.end]
    );

    /* Build per-club summary */
    const clubData = clubs.map(cl => {
      const cid      = String(cl.club_id);
      const clRecs   = records.filter(r => String(r.club_id) === cid);
      const clTasks  = taskRecs.filter(r => String(r.club_id) === cid);
      const present  = clRecs.filter(r => r.status === 'present').length;
      const late     = clRecs.filter(r => r.status === 'late').length;
      const absent   = clRecs.filter(r => r.status === 'absent').length;
      const excused  = clRecs.filter(r => r.status === 'excused').length;
      const tasksDone  = clTasks.filter(t => t.is_completed).length;
      const tasksTotal = clTasks.length;
      const efficiency = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;
      const score      = computeOverallScore(present, clRecs.length, tasksDone, tasksTotal);
      const sl         = scoreToLabel(score);

      return {
        clubId:        cid,
        clubName:      cl.club_name,
        color:         cl.color || '#635bff',
        attendance: {
          sessions: clRecs.length,
          present, late, absent, excused,
          list: clRecs.map(r => ({
            date: r.session_date, label: r.session_label, status: r.status,
          })),
        },
        tasks: {
          total:      tasksTotal,
          completed:  tasksDone,
          efficiency,
          list: clTasks.map(t => ({
            title:        t.task_title,
            completed:    t.is_completed,
            date:         t.completed_date,
          })),
        },
        overallScore:        score,
        scoreLabel:          sl.label,
        scoreColor:          sl.color,
        /* keep flat fields for backwards compat */
        periodPresent:    present,
        periodTasksDone:  tasksDone,
        periodTotalTasks: tasksTotal,
        sessions: clRecs.map(r => ({ date: r.session_date, label: r.session_label, status: r.status })),
      };
    });

    res.json({
      period,
      dateRange: range,
      clubs: clubData,
    });
  } catch (err) { next(err); }
};

/* GET /api/users/me/notifications — unread notifications + WoF status */
const getNotifications = async (req, res, next) => {
  try {
    const [notifRes, wofRes] = await Promise.all([
      pgPool.query(
        `SELECT id, club_id, title, body, type, is_read, created_at, url
         FROM member_notifications
         WHERE user_id = $1 AND is_read = false
         ORDER BY created_at DESC LIMIT 15`,
        [req.user.id]
      ),
      pgPool.query(
        `SELECT 1 FROM wall_of_fame
         WHERE LOWER(email) = LOWER($1) AND is_active = true LIMIT 1`,
        [req.user.email]
      ),
    ]);
    res.json({
      isWallOfFamer: wofRes.rows.length > 0,
      notifications: notifRes.rows.map(n => ({
        id:        String(n.id),
        clubId:    n.club_id ? String(n.club_id) : null,
        title:     n.title,
        body:      n.body,
        type:      n.type,
        isRead:    n.is_read,
        createdAt: n.created_at,
        url:       n.url || '/',
      })),
    });
  } catch (err) { next(err); }
};

/* GET /api/users/me/notifications/unread-count — true total, unlike
   getNotifications() above which caps its list at 15. Powers the OS-level
   app-icon badge (Badging API), which needs the real number, not a capped one. */
const unreadNotificationCount = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT COUNT(*)::int AS count FROM member_notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) { next(err); }
};

/* PATCH /api/users/me/notifications/:id/read  — mark a notification read */
const markNotificationRead = async (req, res, next) => {
  try {
    await pgPool.query(
      `UPDATE member_notifications SET is_read = true WHERE id = $1::bigint AND user_id = $2`,
      [req.params.notifId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/* GET /api/users/me/notifications/all  — full history for the Notifications
   page, paginated, optionally filtered by ?type=. Distinct from
   getNotifications() above, which is capped at 15 unread-only rows for a
   dropdown preview — this is the real "every notification, read or not"
   list a dedicated page needs. */
const getAllNotifications = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = (page - 1) * limit;
    const { type } = req.query;

    const values  = [req.user.id];
    const clauses = ['user_id = $1'];
    if (type) {
      values.push(type);
      clauses.push(`type = $${values.length}`);
    }
    values.push(limit, offset);

    const { rows } = await pgPool.query(
      `SELECT id, club_id, title, body, type, is_read, created_at, url,
              COUNT(*) OVER() AS total_count
       FROM member_notifications
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    res.json({
      notifications: rows.map(n => ({
        id:        String(n.id),
        clubId:    n.club_id ? String(n.club_id) : null,
        title:     n.title,
        body:      n.body,
        type:      n.type,
        isRead:    n.is_read,
        createdAt: n.created_at,
        url:       n.url || '/',
      })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) { next(err); }
};

/* PATCH /api/users/me/notifications/read-all */
const markAllNotificationsRead = async (req, res, next) => {
  try {
    await pgPool.query(
      `UPDATE member_notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/* PUT /api/users/me/profile  (any authenticated user) */
const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;
    const updates = []; const vals = []; let i = 1;

    if (name?.trim()) { updates.push(`name = $${i++}`); vals.push(name.trim()); }

    if (req.file) {
      const avatarVal = await uploadAvatarBuffer(req.file);
      updates.push(`avatar = $${i++}`);
      vals.push(avatarVal);
    }

    if (!updates.length) return res.status(400).json({ message: 'Nothing to update.' });

    vals.push(req.user.id);
    const { rows } = await pgPool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id, email, name, role, avatar, managed_club_id`,
      vals
    );
    const u = rows[0];

    // Bust user session cache
    await cache.del(`session:user:${req.user.id}`);

    // If a coordinator changed their avatar, bust their clubs' cache so the
    // Faculty Coordinator card in the student view updates immediately
    if (req.file && (req.user.role === 'coordinator' || req.user.role === 'faculty_coordinator')) {
      const { rows: clubRows } = await pgPool.query(
        `SELECT club_id FROM coordinator_club_assignments WHERE user_id = $1 AND is_active = true`,
        [req.user.id]
      );
      await Promise.all(clubRows.map(r => cache.del(`clubs:${r.club_id}`)));
    }

    res.json({ user: { ...u, avatar: u.avatar || '', managedClubId: u.managed_club_id || null } });
  } catch (err) { next(err); }
};

/* PUT /api/users/:id/assign-club  (admin) */
const assignClub = async (req, res, next) => {
  try {
    await ensureSoacTables();

    const { clubId } = req.body;
    const userId = req.params.id;

    const { rows } = await pgPool.query(
      `UPDATE users SET managed_club_id = $1
       WHERE id = $2 AND role IN ('coordinator', 'faculty_coordinator')
       RETURNING id, email, name, role, managed_club_id`,
      [clubId || null, userId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Coordinator not found.' });

    if (clubId) {
      await pgPool.query(
        `UPDATE coordinator_club_assignments
         SET is_active = false, updated_at = NOW()
         WHERE club_id = $1 AND user_id != $2`,
        [clubId, userId]
      );
      await pgPool.query(
        `INSERT INTO coordinator_club_assignments (user_id, club_id, is_active)
         VALUES ($1, $2, true)
         ON CONFLICT (user_id, club_id) DO UPDATE
           SET is_active = true, updated_at = NOW()`,
        [userId, clubId]
      );
    } else {
      await pgPool.query(
        `UPDATE coordinator_club_assignments
         SET is_active = false, updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
    }

    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, 'ASSIGN_CLUB', 'user', $3, $4)`,
      [req.user.id, req.user.name, String(userId), JSON.stringify({ clubId })]
    );
    await cache.del(`session:user:${userId}`);
    res.json({ user: rows[0] });

    /* Notify the coordinator when actually assigned to a club (not on removal). */
    if (clubId) {
      pgPool.query(`SELECT name FROM clubs WHERE id = $1`, [clubId])
        .then(({ rows: clubRows }) => {
          const clubName = clubRows[0]?.name || 'a club';
          notifyUser({
            userId,
            clubId,
            title: 'You were assigned as coordinator',
            body:  `You're now the coordinator of ${clubName}.`,
            type:  'coordinator_assignment',
            url:   '/coordinator/my-club',
          });
        }).catch(() => {});
    }
  } catch (err) { next(err); }
};

module.exports = { getAll, create, update, remove, stats, auditLog, myClubs, updateProfile, assignClub, myEventRegistrations, weeklyEvaluation, getNotifications, unreadNotificationCount, markNotificationRead, getAllNotifications, markAllNotificationsRead, myActivity, activityByEmail };
