const bcrypt   = require('bcryptjs');
const { pgPool } = require('../config/db');
const { sendCredentials, sendApproval } = require('../config/email');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds, assertCoordOwnsClub, getClubCoordinatorIds } = require('../services/coordAuth');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const cache = require('../services/cache');

const RKU_DOMAIN = '@rku.ac.in';

/* ── Column lists ───────────────────────────────────────────────────────────*/
const JR_COLS = [
  'id', 'club_id', 'club_name', 'name', 'email',
  'phone', 'enrollment_no', 'dept', 'year', 'gender',
  'message', 'status', 'created_at', 'updated_at',
].join(', ');

(async () => {
  try {
    await pgPool.query(`ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS gender CHAR(1) DEFAULT NULL`);
    console.log('[requests] migrations ready');
  } catch (err) {
    console.error('[requests] migration failed:', err.message);
  }
})();

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

    if (req.user?.role === 'coordinator') {
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

/* Active club-membership count for an email — used both to gate join-request creation and
   by the public pre-submit check the guest join form calls before it even sends a request. */
const countActiveClubs = async (email) => {
  const { rows } = await pgPool.query(
    `SELECT COUNT(sc.*)::int AS cnt
     FROM student_clubs sc
     JOIN users u ON u.id = sc.user_id
     WHERE u.email = $1 AND sc.is_active = true`,
    [String(email || '').toLowerCase()]
  );
  return rows[0].cnt;
};

/* Is this email already an active member of this specific club? Deactivated memberships
   don't count — a dropped student can send a fresh join request for the same club. */
const isActiveMemberOfClub = async (email, clubId) => {
  if (!clubId) return false;
  const { rows } = await pgPool.query(
    `SELECT 1
     FROM student_clubs sc
     JOIN users u ON u.id = sc.user_id
     WHERE u.email = $1 AND sc.club_id = $2::bigint AND sc.is_active = true
     LIMIT 1`,
    [String(email || '').toLowerCase(), clubId]
  );
  return rows.length > 0;
};

/* GET /api/requests/check-club-limit?email=X&clubId=Y  (public)
   Lets the join form ask "is this student already at the 3-club cap, or already a member
   of THIS club?" BEFORE submitting, so it can block the request client-side with an alert
   instead of round-tripping a request that the server would reject anyway. Purely a UX
   pre-check — create() below re-checks both and is the actual enforcement, since this
   endpoint can't be trusted alone. */
const checkClubLimit = async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ message: 'email is required.' });
    const clubId = req.query.clubId ? String(req.query.clubId) : null;
    const [cnt, alreadyMember] = await Promise.all([
      countActiveClubs(email),
      isActiveMemberOfClub(email, clubId),
    ]);
    res.json({ count: cnt, atLimit: cnt >= 3, alreadyMember });
  } catch (err) { next(err); }
};

/* POST /api/requests  (public — student submits join form) */
const create = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId, clubName, name, email, phone, enrollmentNo, dept, year, gender, message } = req.body;
    if (!clubId || !name || !email) return res.status(400).json({ message: 'clubId, name and email are required.' });
    if (!email.toLowerCase().endsWith(RKU_DOMAIN)) {
      return res.status(400).json({ message: 'Only RKU institutional emails (@rku.ac.in) are allowed to join clubs.' });
    }
    if (!gender || !['M', 'F'].includes(gender.toUpperCase())) {
      return res.status(400).json({ message: 'Gender is required. Please select M or F.' });
    }

    /* Authoritative enforcement — block at submission time, not just at approval, so a
       student already active in 3 clubs — or already a member of THIS club — never gets a
       pending request sitting in front of a coordinator even if the client-side pre-check
       was bypassed. */
    if (await isActiveMemberOfClub(email, clubId)) {
      return res.status(400).json({ message: "You're already a member of this club." });
    }
    const activeCount = await countActiveClubs(email);
    if (activeCount >= 3) {
      return res.status(400).json({ message: 'You cannot join more than 3 clubs.' });
    }

    const { rows } = await pgPool.query(
      `INSERT INTO join_requests
       (club_id, club_name, name, email, phone, enrollment_no, dept, year, gender, message, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       RETURNING ${JR_COLS}`,
      [clubId, clubName || '', name.trim(), email.toLowerCase(),
       phone || '', enrollmentNo || '', dept || '', year || '', gender.toUpperCase(), message || '']
    );
    await cache.del('stats:admin');
    res.status(201).json({ request: toJR(rows[0]) });

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

/* POST /api/requests/:id/approve  (coordinator/admin)
   Runs inside a transaction; no N+1 — all reads are targeted. */
const approve = async (req, res, next) => {
  const pgClient = await pgPool.connect();
  try {
    await ensureSoacTables();

    /* Lock the specific request row — only fetch what we need */
    const { rows: jrRows } = await pgClient.query(
      `SELECT id, club_id, club_name, name, email, status
       FROM join_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const jr = jrRows[0];
    if (!jr)                    return res.status(404).json({ message: 'Request not found.' });
    if (jr.status !== 'pending') return res.status(400).json({ message: `Request is already ${jr.status}.` });

    if (req.user?.role === 'coordinator') {
      const ok = await assertCoordOwnsClub(req.user.id, jr.club_id);
      if (!ok) return res.status(403).json({ message: 'You can only approve requests for your assigned club.' });
    }

    await pgClient.query('BEGIN');

    /* 1. Count clubs already enrolled — deactivated memberships don't count against the cap */
    const { rows: cntRows } = await pgClient.query(
      `SELECT COUNT(sc.*)::int AS cnt
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       WHERE u.email = $1 AND sc.is_active = true`,
      [jr.email]
    );
    if (cntRows[0].cnt >= 3) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ message: 'Student has already joined the maximum of 3 clubs.' });
    }

    /* 2. Upsert student account — only select id (avoid pulling password_hash) */
    let userId;
    let tempPassword = null;
    let isNewUser    = false;

    const { rows: userRows } = await pgClient.query(
      `SELECT id FROM users WHERE email = $1`,
      [jr.email]
    );
    if (userRows.length) {
      userId = userRows[0].id;
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
      [req.params.id]
    );
    await pgClient.query('COMMIT');

    /* 4. Invalidate caches — bust club object, all list pages, member list, student profile */
    await Promise.all([
      cache.del('stats:admin'),
      cache.del(`clubs:${jr.club_id}`),
      cache.del(`student:${userId}`),
      cache.delPattern(`clubs:${jr.club_id}:members*`),
      cache.delPattern('clubs:*'),
    ]);

    /* Fire the push the moment membership is actually committed — deliberately
       BEFORE the awaited email send below, not after. notifyUser() is already
       fire-and-forget, but it still can't run until the interpreter reaches
       this line, and an SMTP round trip (500ms-plus, sometimes multi-second)
       sitting ahead of it in source order was silently delaying "instant"
       delivery by however long that email took. */
    notifyUser({
      userId: userId,
      clubId: jr.club_id,
      title:  'Join request approved',
      body:   `You're now a member of ${jr.club_name}.`,
      type:   'join_request',
      url:    `/student/clubs/${jr.club_id}`,
    }).catch(() => {});

    /* 5. Email — attempt send, capture failure so UI can warn */
    let emailSent = false;
    let emailError = null;
    try {
      if (isNewUser) {
        await sendCredentials({ toEmail: jr.email, toName: jr.name, password: tempPassword, clubName: jr.club_name });
      } else {
        await sendApproval({ toEmail: jr.email, toName: jr.name, clubName: jr.club_name });
      }
      emailSent = true;
    } catch (emailErr) {
      emailError = emailErr.message;
      console.error('Email send failed (non-fatal):', emailErr.message);
    }

    res.json({
      message:     isNewUser ? 'Approved — new account created.' : 'Approved — student added to club.',
      newAccount:  isNewUser,
      credentials: isNewUser ? { email: jr.email, password: tempPassword, name: jr.name } : null,
      emailSent,
      emailError:  emailError || undefined,
    });
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    pgClient.release();
  }
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

    if (req.user?.role === 'coordinator') {
      const ok = await assertCoordOwnsClub(req.user.id, jr.club_id);
      if (!ok) return res.status(403).json({ message: 'You can only decline requests for your assigned club.' });
    }

    await pgPool.query(
      `UPDATE join_requests SET status = 'declined', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await cache.del('stats:admin');
    res.json({ message: 'Request declined.' });

    /* Only notify if this email already has an account — a declined request
       for someone who never got one has nowhere to deliver a notification. */
    pgPool.query(`SELECT id FROM users WHERE email = $1`, [jr.email])
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
   Re-sends a password-setup link to the student for an already-approved request.
   Uses the same JWT mechanism as /api/auth/forgot-password. */
const resendEmail = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT jr.id, jr.name, jr.email, jr.club_name, jr.club_id, jr.status,
              u.id AS user_id, u.password_hash
       FROM join_requests jr
       LEFT JOIN users u ON lower(u.email) = lower(jr.email)
       WHERE jr.id = $1`,
      [req.params.id]
    );
    const jr = rows[0];
    if (!jr) return res.status(404).json({ message: 'Request not found.' });
    if (jr.status !== 'approved') return res.status(400).json({ message: 'Can only resend email for approved requests.' });

    if (req.user?.role === 'coordinator') {
      const ok = await assertCoordOwnsClub(req.user.id, jr.club_id);
      if (!ok) return res.status(403).json({ message: 'Not your club.' });
    }

    if (!jr.user_id || !jr.password_hash) {
      return res.status(404).json({ message: 'Student account not found. Please contact admin.' });
    }

    /* Generate a JWT reset token — same mechanism as /api/auth/forgot-password */
    const crypto = require('crypto');
    const jwt    = require('jsonwebtoken');
    const pv     = crypto.createHash('sha256').update(jr.password_hash).digest('hex').slice(0, 16);
    const token  = jwt.sign(
      { id: jr.user_id, pv, purpose: 'password-reset' },
      process.env.RESET_PASSWORD_SECRET,
      { expiresIn: process.env.RESET_PASSWORD_EXPIRES_IN || '30m' }
    );

    const { sendPasswordReset } = require('../config/email');
    let emailSent = false;
    let emailError = null;
    try {
      await sendPasswordReset({ toEmail: jr.email, toName: jr.name, token });
      emailSent = true;
    } catch (err) {
      emailError = err.message;
      console.error('Resend email failed:', err.message);
    }

    res.json({
      emailSent,
      emailError: emailError || undefined,
      message: emailSent
        ? `Password-setup email sent to ${jr.email}`
        : `Email failed: ${emailError}`,
    });
  } catch (err) { next(err); }
};

module.exports = { getAll, create, checkClubLimit, approve, decline, resendEmail };
