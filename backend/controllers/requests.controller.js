const bcrypt   = require('bcryptjs');
const { pgPool } = require('../config/db');
const { sendCredentials, sendApproval, sendRequestsRemoved } = require('../config/email');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds, assertCoordOwnsClub, getClubCoordinatorIds } = require('../services/coordAuth');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const cache = require('../services/cache');
const { CAMPUSES, adminCampus, clubOnCampus } = require('../services/campus');
const { findStaffAccount, unusablePasswordHash, loginProfileFor } = require('../services/accounts');
const { JOIN_KEY, ensureJoinWindowSchema, getJoinState, joinClosedMessage, notifyRenewalContacts, forgetRenewalContact } = require('../services/joinWindow');

const RKU_DOMAIN = '@rku.ac.in';

/* ── Column lists ───────────────────────────────────────────────────────────*/
const JR_COLS = [
  'id', 'club_id', 'club_name', 'name', 'email',
  'phone', 'enrollment_no', 'dept', 'year', 'gender', 'campus',
  'message', 'status', 'created_at', 'updated_at',
].join(', ');

(async () => {
  try {
    await pgPool.query(`ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS gender CHAR(1) DEFAULT NULL`);
    await ensureJoinWindowSchema();
    console.log('[requests] migrations ready');
  } catch (err) {
    console.error('[requests] migration failed:', err.message);
  }
})();

/* ── Join requests open / closed (see services/joinWindow.js) ──────────────── */
/* GET /api/requests/join-status  (public) */
const getJoinStatus = async (req, res, next) => {
  try { res.json(await getJoinState()); } catch (err) { next(err); }
};

/* PUT /api/requests/join-status  (admin)   body: { open: boolean, opensOn?: 'YYYY-MM-DD' }
   Setting a reopening date (or reopening) emails the students cleared by
   "Delete all students" so they can renew their membership. */
const setJoinStatus = async (req, res, next) => {
  try {
    const open = req.body?.open !== false;
    let opensOn = null;
    if (!open && req.body?.opensOn) {
      opensOn = String(req.body.opensOn);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(opensOn) || Number.isNaN(Date.parse(opensOn))) {
        return res.status(400).json({ message: 'Choose a valid date for when requests reopen.' });
      }
      const { rows } = await pgPool.query(`SELECT to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS today`);
      if (opensOn <= rows[0].today) {
        return res.status(400).json({ message: 'The reopening date must be in the future.' });
      }
    }
    await pgPool.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JOIN_KEY, JSON.stringify({ open, opensOn }), req.user.id]
    );
    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, 'setting', $4, $5)`,
      [req.user.id, req.user.name, open ? 'OPEN_JOIN_REQUESTS' : 'CLOSE_JOIN_REQUESTS', JOIN_KEY, JSON.stringify({ opensOn })]
    ).catch(() => {});
    const state  = await getJoinState();
    const emailed = await notifyRenewalContacts(state);
    const base = state.open ? 'Students can send join requests again.' : `Join requests stopped. ${joinClosedMessage(state)}`;
    res.json({
      ...state, emailed,
      message: emailed ? `${base} ${emailed} former member${emailed === 1 ? ' is' : 's are'} being emailed.` : base,
    });
  } catch (err) { next(err); }
};

/* ── Pagination helper ──────────────────────────────────────────────────────*/
const parsePage = (query) => {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
};

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const toJR = (r) => ({
  ...r,
  _id:          String(r.id),
  clubId:       String(r.club_id),
  clubName:     r.club_name,
  enrollmentNo: r.enrollment_no,
  createdAt:    r.created_at,
  updatedAt:    r.updated_at,
});

/* GET /api/requests  (coordinator/admin)
   Supports ?clubId=&status=&page=&limit= */
const getAll = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId, status } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    const values  = [];
    const clauses = [];

    if (req.user?.role === 'coordinator' || req.user?.role === 'faculty_coordinator') {
      const coordClubIds = await getCoordClubIds(req.user.id);
      if (!coordClubIds.length) {
        return res.status(403).json({ message: 'No club assigned to this coordinator account.' });
      }
      if (clubId) {
        if (!coordClubIds.includes(String(clubId))) {
          return res.status(403).json({ message: 'You can only access requests for your assigned club.' });
        }
        values.push(clubId);
        clauses.push(`club_id = $${values.length}::bigint`);
      } else {
        values.push(coordClubIds);
        clauses.push(`club_id = ANY($${values.length}::bigint[])`);
      }
    } else if (clubId) {
      values.push(clubId);
      clauses.push(`club_id = $${values.length}::bigint`);
    }

    /* Admin sees the requests of the campus they're managing */
    const campus = adminCampus(req);
    if (campus) {
      values.push(campus);
      clauses.push(`club_id IN (SELECT id FROM clubs WHERE campus = $${values.length})`);
    }

    if (status) {
      values.push(status);
      clauses.push(`status = $${values.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(limit, offset);
    const { rows } = await pgPool.query(
      `SELECT ${JR_COLS}, COUNT(*) OVER() AS total_count
       FROM join_requests
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      requests:   rows.map(({ total_count, ...r }) => toJR(r)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

const MAX_CLUB_SLOTS = 3;
const REQUEST_LIMIT_MSG = 'You can only send request to 3 clubs.';

/* Club "slots" an email's STUDENT account is using (memberships live on the
   student account; a person's coordinator / advisor account doesn't count): active memberships PLUS pending join
   requests for clubs they aren't already an active member of. A declined request
   frees its slot (so does a coordinator deactivating a membership), which is what
   lets a student send another request once one of their three is declined.
   Used to gate join-request creation and by the public pre-submit check the guest
   join form calls before it even sends a request. `db` is a pool or a checked-out
   client, so create() can run this inside its per-email locked transaction. */
const countUsedClubSlots = async (email, db = pgPool) => {
  const { rows } = await db.query(
    /* Only memberships of clubs that still exist and are active count */
    `SELECT (
       SELECT COUNT(*) FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id AND u.role = 'student'
       JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE LOWER(u.email) = $1 AND sc.is_active = true
     ) + (
       SELECT COUNT(DISTINCT jr.club_id) FROM join_requests jr
       WHERE LOWER(jr.email) = $1 AND jr.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM student_clubs sc2
           JOIN users u2 ON u2.id = sc2.user_id AND u2.role = 'student'
           WHERE LOWER(u2.email) = $1 AND sc2.club_id = jr.club_id AND sc2.is_active = true
         )
     ) AS cnt`,
    [String(email || '').toLowerCase()]
  );
  return Number(rows[0].cnt);
};

/* Is this email already an active member of this specific club? Deactivated memberships
   don't count — a dropped student can send a fresh join request for the same club. */
const isActiveMemberOfClub = async (email, clubId, db = pgPool) => {
  if (!clubId) return false;
  const { rows } = await db.query(
    `SELECT 1
     FROM student_clubs sc
     JOIN users u ON u.id = sc.user_id AND u.role = 'student'
     WHERE LOWER(u.email) = $1 AND sc.club_id = $2::bigint AND sc.is_active = true
     LIMIT 1`,
    [String(email || '').toLowerCase(), clubId]
  );
  return rows.length > 0;
};

/* Does this email already have a pending request for this specific club? */
const hasPendingRequestForClub = async (email, clubId, db = pgPool) => {
  if (!clubId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM join_requests
     WHERE LOWER(email) = $1 AND club_id = $2::bigint AND status = 'pending'
     LIMIT 1`,
    [String(email || '').toLowerCase(), clubId]
  );
  return rows.length > 0;
};

/* The campus this email is already committed to — the campus of a club they're an
   active member of, or have a pending request for — or null if neither. A student
   joins clubs at one campus only; a declined request doesn't commit them. */
const committedCampus = async (email, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT c.campus FROM (
       SELECT sc.club_id, 0 AS pri FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id AND u.role = 'student'
       WHERE LOWER(u.email) = $1 AND sc.is_active = true
       UNION ALL
       SELECT jr.club_id, 1 FROM join_requests jr
       WHERE LOWER(jr.email) = $1 AND jr.status = 'pending'
     ) x
     JOIN clubs c ON c.id = x.club_id
     ORDER BY x.pri
     LIMIT 1`,
    [String(email || '').toLowerCase()]
  );
  return rows[0]?.campus || null;
};

const wrongCampusMsg = (campus) =>
  `You can only send requests to ${campus}. If you made wrong selection of campus, please contact your club coordinator.`;

/* GET /api/requests/check-club-limit?email=X&clubId=Y  (public)
   Lets the join form ask "is this student already using all 3 club slots (active
   memberships + pending requests), already a member of THIS club, or already waiting
   on a request for it?" BEFORE submitting, so it can block the request client-side with
   an alert instead of round-tripping a request that the server would reject anyway.
   Purely a UX pre-check — create() below re-checks all three and is the actual
   enforcement, since this endpoint can't be trusted alone. */
const checkClubLimit = async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ message: 'email is required.' });
    const joinState = await getJoinState();
    if (!joinState.open) return res.json({ joinClosed: true, message: joinClosedMessage(joinState) });
    let clubId = req.query.clubId ? String(req.query.clubId) : null;
    /* The form lists each club once — check the copy on the campus they picked */
    if (clubId && CAMPUSES.includes(req.query.campus)) {
      clubId = (await clubOnCampus(clubId, req.query.campus))?.id ?? clubId;
    }
    const [cnt, alreadyMember, alreadyPending, lockedCampus] = await Promise.all([
      countUsedClubSlots(email),
      isActiveMemberOfClub(email, clubId),
      hasPendingRequestForClub(email, clubId),
      committedCampus(email),
    ]);
    const wrongCampus = !!lockedCampus && CAMPUSES.includes(req.query.campus) && lockedCampus !== req.query.campus;
    res.json({
      count: cnt, atLimit: cnt >= MAX_CLUB_SLOTS, alreadyMember, alreadyPending,
      wrongCampus, campusMessage: wrongCampus ? wrongCampusMsg(lockedCampus) : undefined,
    });
  } catch (err) { next(err); }
};

/* POST /api/requests  (public — student submits join form) */
const create = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId: listedClubId, name, email, phone, enrollmentNo, dept, year, gender, campus, message } = req.body;
    if (!listedClubId || !name || !email) return res.status(400).json({ message: 'clubId, name and email are required.' });
    if (!email.toLowerCase().endsWith(RKU_DOMAIN)) {
      return res.status(400).json({ message: 'Only RKU institutional emails (@rku.ac.in) are allowed to join clubs.' });
    }
    if (!gender || !['M', 'F'].includes(gender.toUpperCase())) {
      return res.status(400).json({ message: 'Gender is required. Please select M or F.' });
    }
    if (!CAMPUSES.includes(campus)) {
      return res.status(400).json({ message: 'Campus is required. Please select Main Campus or City Campus.' });
    }

    const joinState = await getJoinState();
    if (!joinState.open) return res.status(403).json({ message: joinClosedMessage(joinState), joinClosed: true });

    /* The form lists each club once; the request goes to that club's copy on the
       chosen campus, so it lands with that campus's coordinators. */
    const club = await clubOnCampus(listedClubId, campus);
    if (!club) return res.status(404).json({ message: 'Club not found.' });
    const clubId   = String(club.id);
    const clubName = club.name;

    /* Authoritative enforcement — block at submission time, not just at approval, so a
       student who is already a member of THIS club, already waiting on a request for it,
       or already using all 3 club slots (active memberships + pending requests) never
       gets another pending request sitting in front of a coordinator, even if the
       client-side pre-check was bypassed. The check and the insert run in one
       transaction under a per-email advisory lock, so two simultaneous requests for
       different clubs can't both read "2 slots used" and both get through. */
    const emailLc = email.toLowerCase();
    const client  = await pgPool.connect();
    let blocked = null;
    let created = null;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`join_request:${emailLc}`]);

      const lockedCampus = await committedCampus(emailLc, client);
      if (lockedCampus && lockedCampus !== campus) {
        blocked = { status: 409, message: wrongCampusMsg(lockedCampus) };
      } else if (await isActiveMemberOfClub(emailLc, clubId, client)) {
        blocked = { status: 400, message: "You're already a member of this club." };
      } else if (await hasPendingRequestForClub(emailLc, clubId, client)) {
        blocked = { status: 409, message: 'You already have a pending request for this club.' };
      } else if (await countUsedClubSlots(emailLc, client) >= MAX_CLUB_SLOTS) {
        blocked = { status: 400, message: REQUEST_LIMIT_MSG };
      } else {
        const { rows: ins } = await client.query(
          `INSERT INTO join_requests
           (club_id, club_name, name, email, phone, enrollment_no, dept, year, gender, campus, message, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
           RETURNING ${JR_COLS}`,
          [clubId, clubName || '', name.trim(), emailLc,
           phone || '', enrollmentNo || '', dept || '', year || '', gender.toUpperCase(), campus, message || '']
        );
        created = ins[0];
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
    if (blocked) return res.status(blocked.status).json({ message: blocked.message });

    await Promise.all([
      cache.del('stats:admin', 'stats:admin:city'),
      resetActivityReportLimit([emailLc]),
      forgetRenewalContact(emailLc),   // they've renewed — no more reopening emails
    ]);
    res.status(201).json({ request: toJR(created) });

    /* Notify every coordinator assigned to this club — fire-and-forget.
       Uses the same tiered fallback as coordinator auth (not a raw
       coordinator_club_assignments query) so a coordinator whose assignment
       row was never persisted still gets notified instead of silently missing
       every join request for their club. */
    getClubCoordinatorIds(clubId).then((coordIds) => {
      if (!coordIds.length) return;
      notifyManyUsers({
        userIds: coordIds,
        clubId,
        title: 'New join request',
        body:  `${name.trim()} wants to join ${clubName || 'your club'}.`,
        type:  'join_request',
        url:   '/coordinator/requests',
      });
    }).catch((e) => console.error(`[requests] join-request coordinator notify failed for club ${clubId}:`, e.message));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'A pending request for this club already exists from this email.' });
    next(err);
  }
};

const isCoord = (user) => user?.role === 'coordinator' || user?.role === 'faculty_coordinator';

/* The public "My Activity" lookup emails a report at most once a day per email.
   When a student's requests change (sent, approved, declined, deleted), lift that
   limit so their next lookup sends a fresh report instead of "already sent" — the
   earlier report no longer matches what's on record. */
const resetActivityReportLimit = (emails, db = pgPool) => {
  const list = [...new Set(emails.filter(Boolean).map(e => String(e).toLowerCase()))];
  if (!list.length) return Promise.resolve();
  return db.query(`DELETE FROM activity_email_requests WHERE email = ANY($1::text[])`, [list])
    .catch(err => console.error('[requests] activity report reset failed:', err.message));
};

/* Core of approving one pending request, shared by the single and bulk endpoints.
   Returns { ok: false, status, message } when the request can't be approved, or
   { ok: true, jr, userId, isNewUser, tempPassword } once membership is committed.
   Cache busting and the email are left to the caller, so bulk approve can bust
   caches once per batch and send emails after it has responded. */
const approveOne = async (id, user) => {
  const pgClient = await pgPool.connect();
  try {
    await pgClient.query('BEGIN');

    /* Lock the specific request row — only fetch what we need */
    const { rows: jrRows } = await pgClient.query(
      `SELECT id, club_id, club_name, name, email, status
       FROM join_requests WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const jr = jrRows[0];
    const fail = async (status, message) => {
      await pgClient.query('ROLLBACK');
      return { ok: false, status, message };
    };
    if (!jr)                     return fail(404, 'Request not found.');
    if (jr.status !== 'pending') return fail(400, `Request is already ${jr.status}.`);

    if (isCoord(user) && !(await assertCoordOwnsClub(user.id, jr.club_id))) {
      return fail(403, 'You can only approve requests for your assigned club.');
    }

    /* 1. Count clubs already enrolled — deactivated memberships don't count against the cap */
    const { rows: cntRows } = await pgClient.query(
      `SELECT COUNT(sc.*)::int AS cnt
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE u.email = $1 AND sc.is_active = true`,
      [jr.email]
    );
    if (cntRows[0].cnt >= 3) return fail(400, 'Student has already joined the maximum of 3 clubs.');

    /* A student belongs to one campus — never approve into the other campus's club */
    const { rows: campusRows } = await pgClient.query(
      `SELECT mc.campus
       FROM student_clubs sc
       JOIN users u  ON u.id = sc.user_id AND u.role = 'student'
       JOIN clubs mc ON mc.id = sc.club_id
       JOIN clubs rc ON rc.id = $2
       WHERE LOWER(u.email) = LOWER($1) AND sc.is_active = true AND mc.campus <> rc.campus
       LIMIT 1`,
      [jr.email, jr.club_id]
    );
    if (campusRows.length) {
      return fail(400, `Student is already a member of a club at ${campusRows[0].campus}, so they can't join a club at another campus.`);
    }

    /* 2. Upsert student account — only select id (avoid pulling password_hash) */
    let userId;
    let tempPassword = null;
    let isNewUser    = false;

    const { rows: userRows } = await pgClient.query(
      /* Membership always lives on the STUDENT profile. Someone who is already a
         coordinator / advisor gets a member profile linked to that login. */
      `SELECT id, must_change_password FROM users WHERE LOWER(email) = LOWER($1) AND role = 'student'`,
      [jr.email]
    );
    if (userRows.length) {
      /* Already has a member account — their existing login keeps working, so
         this approval only sends the "accepted to <club>" email, never new
         credentials. (A lost password is handled by Resend Login Email or
         Forgot Password.) */
      userId = userRows[0].id;
    } else if (await findStaffAccount(jr.email, pgClient)) {
      /* Already signs in as a coordinator / advisor — add a member profile linked
         to that login: no new password, they switch to the student dashboard */
      const { rows: ins } = await pgClient.query(
        `INSERT INTO users (email, name, role, password_hash, is_active, must_change_password, linked_profile)
         VALUES ($1, $2, 'student', $3, true, false, true)
         RETURNING id`,
        [jr.email, jr.name, await unusablePasswordHash()]
      );
      userId = ins[0].id;
    } else {
      isNewUser    = true;
      tempPassword = generatePassword();
      const hash   = await bcrypt.hash(tempPassword, 12);
      const { rows: ins } = await pgClient.query(
        `INSERT INTO users (email, name, role, password_hash, is_active, must_change_password)
         VALUES ($1, $2, 'student', $3, true, true)
         RETURNING id`,
        [jr.email, jr.name, hash]
      );
      userId = ins[0].id;
    }

    /* 3. Record membership + sync member_count + mark request approved.
       Re-approving someone previously deactivated from this same club reactivates that
       same row (clears deactivated_at/by, refreshes joined_at) rather than leaving a stale
       inactive row behind. */
    await pgClient.query(
      `INSERT INTO student_clubs (user_id, club_id, club_name) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, club_id) DO UPDATE SET
         is_active      = true,
         deactivated_at = NULL,
         deactivated_by = NULL,
         joined_at      = NOW()`,
      [userId, jr.club_id, jr.club_name]
    );
    /* Always sync member_count from the real active-row count — avoids +1/-1 drift */
    await pgClient.query(
      `UPDATE clubs
       SET member_count = (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = $1 AND is_active = true),
           updated_at   = NOW()
       WHERE id = $1`,
      [jr.club_id]
    );
    await pgClient.query(
      `UPDATE join_requests SET status = 'approved', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await pgClient.query('COMMIT');
    await resetActivityReportLimit([jr.email]);

    /* Fire the push the moment membership is actually committed — before any email
       send, so an SMTP round trip never delays "instant" delivery. */
    notifyUser({
      userId: userId,
      clubId: jr.club_id,
      title:  'Join request approved',
      body:   `You're now a member of ${jr.club_name}.`,
      type:   'join_request',
      url:    `/student/clubs/${jr.club_id}`,
    }).catch(() => {});

    return { ok: true, jr, userId, isNewUser, tempPassword };
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    pgClient.release();
  }
};

/* Bust club object, member lists, list pages and the student profiles touched by approvals */
const bustApprovalCaches = (clubIds, userIds) => Promise.all([
  cache.del('stats:admin', 'stats:admin:city'),
  ...clubIds.map(id => cache.del(`clubs:${id}`)),
  ...userIds.map(id => cache.del(`student:${id}`)),
  ...clubIds.map(id => cache.delPattern(`clubs:${id}:members*`)),
  cache.delPattern('clubs:*'),
]);

/* A coordinator / advisor who joins a club reaches the student dashboard from
   the login they already use */
const memberSwitchNote = async (email) => (await findStaffAccount(email))
  ? 'Use your usual SOAC login — no new password is needed. After signing in, tap <strong>"Switch to Student dashboard"</strong> in the menu to see your clubs as a member, and switch back any time.'
  : null;

/* Credentials only when the member account is created; otherwise acceptance only */
const sendApprovalEmail = async ({ jr, tempPassword }) => (tempPassword
  ? sendCredentials({ toEmail: jr.email, toName: jr.name, password: tempPassword, clubName: jr.club_name })
  : sendApproval({ toEmail: jr.email, toName: jr.name, clubName: jr.club_name, switchNote: await memberSwitchNote(jr.email) }));

/* POST /api/requests/:id/approve  (coordinator/admin) */
const approve = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const result = await approveOne(req.params.id, req.user);
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    const { jr, userId, isNewUser, tempPassword } = result;

    await bustApprovalCaches([jr.club_id], [userId]);

    /* Email — attempt send, capture failure so UI can warn */
    let emailSent = false;
    let emailError = null;
    try {
      await sendApprovalEmail(result);
      emailSent = true;
    } catch (emailErr) {
      emailError = emailErr.message;
      console.error('Email send failed (non-fatal):', emailErr.message);
    }

    res.json({
      message:     isNewUser ? 'Approved — new account created.' : 'Approved — student added to club.',
      newAccount:  isNewUser,
      credentials: tempPassword ? { email: jr.email, password: tempPassword, name: jr.name } : null,
      emailSent,
      emailError:  emailError || undefined,
    });
  } catch (err) { next(err); }
};

const BULK_APPROVE_MAX = 50;
const BULK_DELETE_MAX  = 5000;

const parseIds = (body, max) => {
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String).filter(v => /^\d+$/.test(v)))] : [];
  if (!ids.length)       return { error: 'ids must be a non-empty array of request ids.' };
  if (ids.length > max)  return { error: `At most ${max} requests per call.` };
  return { ids };
};

/* POST /api/requests/bulk-approve  (coordinator/admin)   body: { ids: [] }
   Approves each request with the same rules as the single endpoint, one transaction
   each, so one bad request (already 3 clubs, not your club…) doesn't sink the rest.
   Emails go out after responding — the shared send queue paces them — and a student
   whose email fails can still get a login link via "Resend Login Email". */
const bulkApprove = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { ids, error } = parseIds(req.body, BULK_APPROVE_MAX);
    if (error) return res.status(400).json({ message: error });

    const approved = [];
    const skipped  = [];
    for (const id of ids) {
      const result = await approveOne(id, req.user);
      if (result.ok) approved.push(result);
      else skipped.push({ id, message: result.message });
    }

    if (approved.length) {
      await bustApprovalCaches(
        [...new Set(approved.map(a => String(a.jr.club_id)))],
        [...new Set(approved.map(a => a.userId))],
      );
    }

    res.json({
      approved:    approved.length,
      newAccounts: approved.filter(a => a.isNewUser).length,
      skipped,
    });

    for (const a of approved) {
      sendApprovalEmail(a).catch(err =>
        console.error(`[requests] bulk-approve email failed for ${a.jr.email}:`, err.message));
    }
  } catch (err) { next(err); }
};

/* POST /api/requests/bulk-delete  (coordinator/admin)   body: { ids: [] }
   Permanently removes PENDING requests (approved/declined history is left alone).
   Deleting frees the student's club slot and the per-club pending check, so they can
   request the same clubs again. Each affected student gets one email listing every
   club whose request was removed. */
const bulkDelete = async (req, res, next) => {
  try {
    const { ids, error } = parseIds(req.body, BULK_DELETE_MAX);
    if (error) return res.status(400).json({ message: error });

    const values  = [ids];
    let clubScope = '';
    if (isCoord(req.user)) {
      const coordClubIds = await getCoordClubIds(req.user.id);
      if (!coordClubIds.length) return res.status(403).json({ message: 'No club assigned to this coordinator account.' });
      values.push(coordClubIds);
      clubScope = 'AND club_id = ANY($2::bigint[])';
    }

    const { rows } = await pgPool.query(
      `DELETE FROM join_requests
       WHERE id = ANY($1::bigint[]) AND status = 'pending' ${clubScope}
       RETURNING id, club_id, club_name, name, email`,
      values
    );
    await Promise.all([
      cache.del('stats:admin', 'stats:admin:city'),
      resetActivityReportLimit(rows.map(r => r.email)),
    ]);
    res.json({ deleted: rows.length, skipped: ids.length - rows.length });

    /* Group per student so each gets a single email, then notify / email in the background */
    const byEmail = new Map();
    for (const r of rows) {
      const key = r.email.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, { email: r.email, name: r.name, clubs: [] });
      byEmail.get(key).clubs.push({ id: r.club_id, name: r.club_name });
    }

    const students = [...byEmail.values()];
    pgPool.query(`SELECT id, LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1::text[]) AND role = 'student'`, [[...byEmail.keys()]])
      .then(({ rows: uRows }) => {
        for (const u of uRows) {
          const s = byEmail.get(u.email);
          const names = s.clubs.map(c => c.name).join(', ');
          notifyUser({
            userId: u.id,
            clubId: s.clubs[0].id,
            title:  'Join request removed',
            body:   `Your request to join ${names} was removed. You can request to join again.`,
            type:   'join_request',
            url:    '/student/clubs',
          }).catch(() => {});
        }
      }).catch(() => {});

    for (const s of students) {
      sendRequestsRemoved({ toEmail: s.email, toName: s.name, clubNames: s.clubs.map(c => c.name) })
        .catch(err => console.error(`[requests] bulk-delete email failed for ${s.email}:`, err.message));
    }
  } catch (err) { next(err); }
};

/* POST /api/requests/:id/decline  (coordinator/admin) */
const decline = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, status, club_id, club_name, email FROM join_requests WHERE id = $1`,
      [req.params.id]
    );
    const jr = rows[0];
    if (!jr)                    return res.status(404).json({ message: 'Request not found.' });
    if (jr.status !== 'pending') return res.status(400).json({ message: `Request is already ${jr.status}.` });

    if (req.user?.role === 'coordinator' || req.user?.role === 'faculty_coordinator') {
      const ok = await assertCoordOwnsClub(req.user.id, jr.club_id);
      if (!ok) return res.status(403).json({ message: 'You can only decline requests for your assigned club.' });
    }

    await pgPool.query(
      `UPDATE join_requests SET status = 'declined', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await Promise.all([
      cache.del('stats:admin', 'stats:admin:city'),
      resetActivityReportLimit([jr.email]),
    ]);
    res.json({ message: 'Request declined.' });

    /* Only notify if this email already has an account — a declined request
       for someone who never got one has nowhere to deliver a notification. */
    pgPool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'student'`, [jr.email])
      .then(({ rows: uRows }) => {
        if (!uRows.length) return;
        notifyUser({
          userId: uRows[0].id,
          clubId: jr.club_id,
          title:  'Join request declined',
          body:   `Your request to join ${jr.club_name} was declined.`,
          type:   'join_request',
          url:    '/student/clubs',
        });
      }).catch(() => {});
  } catch (err) { next(err); }
};

/* POST /api/requests/:id/resend-email  (coordinator/admin)
   Issues the student of an already-approved request a fresh temporary password,
   emails it, and returns it so the admin / coordinator can share it directly if the
   email doesn't arrive. The student must change it on next login. */
const resendEmail = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT jr.id, jr.name, jr.email, jr.club_name, jr.club_id, jr.status,
              u.id AS user_id, u.password_hash
       FROM join_requests jr
       LEFT JOIN users u ON lower(u.email) = lower(jr.email) AND u.role = 'student'
       WHERE jr.id = $1`,
      [req.params.id]
    );
    const jr = rows[0];
    if (!jr) return res.status(404).json({ message: 'Request not found.' });
    if (jr.status !== 'approved') return res.status(400).json({ message: 'Can only resend email for approved requests.' });

    if (req.user?.role === 'coordinator' || req.user?.role === 'faculty_coordinator') {
      const ok = await assertCoordOwnsClub(req.user.id, jr.club_id);
      if (!ok) return res.status(403).json({ message: 'Not your club.' });
    }

    if (!jr.user_id) {
      return res.status(404).json({ message: 'Student account not found. Please contact admin.' });
    }

    /* The new password goes on the profile that holds the person's login — for a
       member profile linked to their coordinator login, that's the coordinator
       login (one password opens both dashboards). Changing password_hash also
       invalidates any outstanding reset links, which are bound to the old hash. */
    const loginProfile = await loginProfileFor(jr.user_id);
    const tempPassword = generatePassword();
    await pgPool.query(
      `UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2`,
      [await bcrypt.hash(tempPassword, 12), loginProfile.id]
    );

    let emailSent = false;
    let emailError = null;
    try {
      await sendCredentials({
        toEmail: jr.email, toName: jr.name, password: tempPassword,
        otherAccountNote: loginProfile.id !== jr.user_id
          ? 'This one password opens both of your dashboards — sign in, then use <strong>"Switch to Student dashboard"</strong> in the menu.'
          : null,
      });
      emailSent = true;
    } catch (err) {
      emailError = err.message;
      console.error('Resend email failed:', err.message);
    }

    res.json({
      emailSent,
      emailError:  emailError || undefined,
      credentials: { email: jr.email, password: tempPassword, name: jr.name },
      message: emailSent
        ? `New login details sent to ${jr.email}`
        : `Email failed: ${emailError} — share the password shown with the student.`,
    });
  } catch (err) { next(err); }
};

module.exports = { getJoinStatus, setJoinStatus, getAll, create, checkClubLimit, approve, bulkApprove, bulkDelete, decline, resendEmail };
