const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { pgPool } = require('../config/db');
const { sendCoordinatorCredentials, sendCoordinatorAssignment } = require('../config/email');
const { ensureSoacTables, asClub } = require('../services/soacData');
const { assertCoordOwnsClub, getCoordClubIds } = require('../services/coordAuth');
const cache = require('../services/cache');

/* ── Column list (every column asClub() reads) ─────────────────────────────
   Avoids SELECT * so the result set is predictable regardless of future
   schema additions, and lets the query planner know exactly what to fetch. */
const CLUB_COLS = [
  'id', 'name', 'slug', 'category', 'color', 'logo', 'coordinator',
  'founded_year', 'description', 'tags', 'vision', 'rules', 'schedule',
  'is_active', 'created_at', 'updated_at',
].join(', ');

/* ── Pagination helper ──────────────────────────────────────────────────────
   Reads ?page= and ?limit= from query string.
   Returns offset and a capped limit (max 200). */
const parsePage = (query) => {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
};

const logoUrl = (filename) => {
  if (!filename) return '';
  return /^\d{13}-/.test(filename)
    ? `/uploads/logos/${filename}`
    : `/logos/${filename}`;
};

const withLogoUrl = (club) => {
  const obj = { ...club };
  obj._id    = String(obj._id || obj.id);
  obj.logoUrl = logoUrl(obj.logo);
  return obj;
};

const logAudit = async (userId, userName, action, entityType, entityId, meta = {}) => {
  try {
    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, userName, action, entityType, String(entityId), JSON.stringify(meta)]
    );
  } catch (_) {}
};

const deleteFile = (filename, subdir) => {
  if (!filename) return;
  const fp = path.join(__dirname, '..', 'uploads', subdir, filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
};

/* GET /api/clubs  (public)
   Supports ?page=&limit=&category=&search=
   COUNT(*) OVER() gives total in one query — no extra round-trip.
   Cache-aside: clubs:<hash> → 60 s */
const getAll = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { category, search } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    const cacheKey = cache.hashKey('clubs', { category, search, page, limit });
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const values  = [];
    const clauses = ['is_active = true'];
    if (category && category !== 'all') {
      values.push(category);
      clauses.push(`category = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`name ILIKE $${values.length}`);
    }

    values.push(limit, offset);
    const { rows } = await pgPool.query(
      `SELECT ${CLUB_COLS},
              (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = clubs.id) AS real_member_count,
              (SELECT COUNT(*)::int FROM events WHERE club = clubs.name AND is_active = true) AS real_event_count,
              COUNT(*) OVER() AS total_count
       FROM clubs
       WHERE ${clauses.join(' AND ')}
       ORDER BY name ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total  = Number(rows[0]?.total_count ?? 0);
    const result = {
      clubs:      rows.map((r) => {
        const club = asClub(r);
        club.memberCount = r.real_member_count;   // live count
        club.eventCount  = r.real_event_count;    // live count
        return withLogoUrl(club);
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
    await cache.set(cacheKey, result, cache.TTL.CLUBS_LIST);
    res.json(result);
  } catch (err) { next(err); }
};

/* GET /api/clubs/:id  (public)
   Cache-aside: clubs:<id> → 120 s
   Always includes a live member count from student_clubs so the number
   shown to students and coordinators is never stale. */
const getOne = async (req, res, next) => {
  try {
    const cacheKey = `clubs:${req.params.id}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT ${CLUB_COLS},
              (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = clubs.id) AS real_member_count,
              (SELECT COUNT(*)::int FROM events WHERE club = clubs.name AND is_active = true) AS real_event_count
       FROM clubs WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Club not found.' });

    const club = asClub(rows[0]);
    club.memberCount = rows[0].real_member_count;
    club.eventCount  = rows[0].real_event_count;
    const result = { club: withLogoUrl(club) };
    await cache.set(cacheKey, result, cache.TTL.CLUB);
    res.json(result);
  } catch (err) { next(err); }
};

/* POST /api/clubs  (admin) */
const create = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { name, category, color, coordinator, foundedYear, memberCount, eventCount, description, tags } = req.body;
    const logo = req.file ? req.file.filename : '';
    const { rows } = await pgPool.query(
      `INSERT INTO clubs
       (name, slug, category, color, coordinator, founded_year, member_count, event_count, description, tags, logo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${CLUB_COLS}`,
      [
        name, slugify(name, { lower: true, strict: true }),
        category, color || '#635BFF', coordinator || '',
        foundedYear || '', Number(memberCount) || 0, Number(eventCount) || 0,
        description || '', tags ? JSON.parse(tags) : [], logo,
      ]
    );
    const club = asClub(rows[0]);
    await logAudit(req.user.id, req.user.name, 'CREATE_CLUB', 'club', club.id, { name });
    await Promise.all([cache.delPattern('clubs:*'), cache.del('stats:admin')]);
    res.status(201).json({ club: withLogoUrl(club) });
  } catch (err) { next(err); }
};

/* PUT /api/clubs/:id  (admin) */
const update = async (req, res, next) => {
  try {
    /* Fetch only the fields we need for the update logic */
    const { rows: cur } = await pgPool.query(
      `SELECT id, name, logo FROM clubs WHERE id = $1`,
      [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ message: 'Club not found.' });
    const current = cur[0];

    const { name, category, color, coordinator, foundedYear, memberCount, eventCount, description, tags } = req.body;
    const nextLogo  = req.file ? req.file.filename : current.logo;
    if (req.file) deleteFile(current.logo, 'logos');
    const finalName = name || current.name;

    const { rows } = await pgPool.query(
      `UPDATE clubs
       SET name         = $1,
           slug         = $2,
           category     = COALESCE($3, category),
           color        = COALESCE($4, color),
           coordinator  = COALESCE($5, coordinator),
           founded_year = COALESCE($6, founded_year),
           member_count = COALESCE($7, member_count),
           event_count  = COALESCE($8, event_count),
           description  = COALESCE($9, description),
           tags         = COALESCE($10, tags),
           logo         = $11
       WHERE id = $12
       RETURNING ${CLUB_COLS}`,
      [
        finalName, slugify(finalName, { lower: true, strict: true }),
        category ?? null, color ?? null, coordinator ?? null,
        foundedYear ?? null,
        memberCount !== undefined ? Number(memberCount) : null,
        eventCount  !== undefined ? Number(eventCount)  : null,
        description ?? null, tags ? JSON.parse(tags) : null,
        nextLogo, req.params.id,
      ]
    );
    const club = asClub(rows[0]);
    await logAudit(req.user.id, req.user.name, 'UPDATE_CLUB', 'club', club.id, { name: club.name });
    await Promise.all([cache.del(`clubs:${req.params.id}`), cache.delPattern('clubs:*')]);
    res.json({ club: withLogoUrl(club) });
  } catch (err) { next(err); }
};

/* DELETE /api/clubs/:id  (admin — permanent cascading delete) */
const remove = async (req, res, next) => {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    /* 1. Fetch club before anything is deleted */
    const { rows: clubRows } = await client.query(
      `SELECT id, name, logo FROM clubs WHERE id = $1`,
      [req.params.id]
    );
    if (!clubRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Club not found.' });
    }
    const club = clubRows[0];

    /* 2. Delete events by club name (stored as plain text — no FK).
          event_registrations cascade from events automatically. */
    await client.query(`DELETE FROM events WHERE club ILIKE $1`, [club.name]);

    /* 3. Hard-delete the club row.
          All tables with ON DELETE CASCADE FK clean up automatically:
          join_requests, student_clubs, club_announcements,
          club_leadership, club_messages, club_tasks,
          club_attendance_sessions (→ records cascade),
          member_progress, event_requests */
    await client.query(`DELETE FROM clubs WHERE id = $1`, [req.params.id]);

    await client.query('COMMIT');

    /* 4. Remove logo file from disk (fire-and-forget) */
    if (club.logo) deleteFile(club.logo, 'logos');

    /* 5. Audit log + cache bust */
    await logAudit(req.user.id, req.user.name, 'DELETE_CLUB', 'club', club.id, { name: club.name });
    await Promise.all([
      cache.del(`clubs:${req.params.id}`),
      cache.del(`clubs:${req.params.id}:members`),
      cache.delPattern('clubs:*'),
      cache.del('stats:admin'),
    ]);

    res.json({ message: `"${club.name}" and all associated data have been permanently deleted.` });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

/* GET /api/clubs/stats  (admin) */
const stats = async (req, res, next) => {
  try {
    const [{ rows: totalRows }, { rows: byCategory }] = await Promise.all([
      pgPool.query(`SELECT COUNT(*)::int AS total FROM clubs WHERE is_active = true`),
      pgPool.query(`SELECT category AS _id, COUNT(*)::int AS count FROM clubs WHERE is_active = true GROUP BY category`),
    ]);
    res.json({ total: totalRows[0].total, byCategory });
  } catch (err) { next(err); }
};

/* GET /api/clubs/public/stats (open)
   Used for landing page hero counters */
const publicStats = async (req, res, next) => {
  try {
    const [cRes, mRes, eRes] = await Promise.all([
      pgPool.query(`SELECT COUNT(*)::int AS count FROM clubs  WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM student_clubs`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM events WHERE is_active = true`),
    ]);
    res.json({
      clubs:    cRes.rows[0].count,
      members:  mRes.rows[0].count,
      events:   eRes.rows[0].count,
    });
  } catch (err) { next(err); }
};

/* POST /api/clubs/seed  (admin) */
const seed = async (req, res, next) => {
  try {
    const autoSeed = require('../scripts/autoSeed');
    await autoSeed();
    const { rows } = await pgPool.query('SELECT COUNT(*)::int AS count FROM clubs WHERE is_active = true');
    await Promise.all([cache.delPattern('clubs:*'), cache.del('stats:admin')]);
    res.json({ message: `Seed complete. ${rows[0].count} clubs in database.`, count: rows[0].count });
  } catch (err) { next(err); }
};

/* GET /api/clubs/mine  (coordinator) — returns all clubs assigned to this coordinator.
   Uses coordAuth.getCoordClubIds (assignments + legacy managed_club_id + name + auto-repair). */
const mine = async (req, res, next) => {
  try {
    await ensureSoacTables();

    const clubIds = await getCoordClubIds(req.user.id);
    if (!clubIds.length) {
      return res.status(404).json({ message: 'No club assigned to this coordinator. Ask an admin to assign your club.' });
    }

    const MINE_COLS = `${CLUB_COLS},
      (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = clubs.id) AS real_member_count,
      (SELECT COUNT(*)::int FROM events WHERE club = clubs.name AND is_active = true) AS real_event_count`;

    const { rows } = await pgPool.query(
      `SELECT ${MINE_COLS}
       FROM clubs
       WHERE id = ANY($1::bigint[]) AND is_active = true
       ORDER BY array_position($1::bigint[], id)`,
      [clubIds.map(id => Number(id) || id)]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'No club assigned to this coordinator. Ask an admin to assign your club.' });
    }

    const clubs = rows.map(r => {
      const c = asClub(r);
      c.memberCount = r.real_member_count;
      c.eventCount  = r.real_event_count;
      return withLogoUrl(c);
    });

    res.json({ clubs });
  } catch (err) { next(err); }
};

/* GET /api/clubs/:id/members  (coordinator/admin)
   Supports ?search=&dept=&year=&page=&limit=
   Single LATERAL JOIN — no N+1. Cache keyed on all filter params. */
const getMembers = async (req, res, next) => {
  try {
    if (req.user?.role === 'coordinator') {
      const ok = await assertCoordOwnsClub(req.user.id, req.params.id);
      if (!ok) return res.status(403).json({ message: 'You can only access members for your assigned club.' });
    }

    const { page, limit, offset } = parsePage(req.query);
    const { search, dept, year }  = req.query;

    const cacheKey = cache.hashKey(`clubs:${req.params.id}:members`, { page, limit, search, dept, year });
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    /* $1 = club_id (used in main WHERE and inside LATERAL JOIN) */
    const values        = [req.params.id];
    const filterClauses = [];

    if (dept) {
      values.push(dept);
      filterClauses.push(`COALESCE(jr.dept, '') = $${values.length}`);
    }
    if (year) {
      values.push(year);
      filterClauses.push(`COALESCE(jr.year, '') = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      filterClauses.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR COALESCE(jr.enrollment_no,'') ILIKE $${idx})`);
    }

    const filterSQL = filterClauses.length ? `AND ${filterClauses.join(' AND ')}` : '';
    values.push(limit, offset);

    const { rows } = await pgPool.query(
      `SELECT
         sc.user_id   AS id,
         sc.club_id,
         sc.club_name,
         sc.joined_at,
         u.name,
         u.email,
         u.is_active,
         COALESCE(jr.dept,          '') AS dept,
         COALESCE(jr.year,          '') AS year,
         COALESCE(jr.phone,         '') AS phone,
         COALESCE(jr.enrollment_no, '') AS "enrollmentNo",
         COALESCE(jr.message,       '') AS message,
         COUNT(*) OVER()               AS total_count
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       LEFT JOIN LATERAL (
         SELECT dept, year, phone, enrollment_no, message
         FROM   join_requests
         WHERE  club_id = $1::bigint
           AND  email   = u.email
           AND  status  = 'approved'
         ORDER BY updated_at DESC
         LIMIT 1
       ) jr ON true
       WHERE sc.club_id = $1::bigint
         ${filterSQL}
       ORDER BY sc.joined_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total  = Number(rows[0]?.total_count ?? 0);
    const result = {
      members:    rows.map(({ total_count, ...r }) => r),
      count:      total,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
    await cache.set(cacheKey, result, cache.TTL.CLUB_MEMBERS);
    res.json(result);
  } catch (err) { next(err); }
};

/* GET /api/clubs/members  (admin only)
   All student club memberships across every club.
   Supports ?search=&dept=&year=&clubId=&page=&limit= */
const getAllMembers = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { page, limit, offset }         = parsePage(req.query);
    const { search, dept, year, clubId }  = req.query;

    const values        = [];
    const filterClauses = [];

    if (clubId) {
      values.push(clubId);
      filterClauses.push(`sc.club_id = $${values.length}::bigint`);
    }
    if (dept) {
      values.push(dept);
      filterClauses.push(`COALESCE(jr.dept, '') = $${values.length}`);
    }
    if (year) {
      values.push(year);
      filterClauses.push(`COALESCE(jr.year, '') = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      filterClauses.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR COALESCE(jr.enrollment_no,'') ILIKE $${idx})`);
    }

    const whereSQL = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';
    values.push(limit, offset);

    const { rows } = await pgPool.query(
      `SELECT
         sc.user_id   AS id,
         sc.club_id,
         sc.club_name,
         sc.joined_at,
         u.name,
         u.email,
         u.is_active,
         COALESCE(jr.dept,          '') AS dept,
         COALESCE(jr.year,          '') AS year,
         COALESCE(jr.phone,         '') AS phone,
         COALESCE(jr.enrollment_no, '') AS "enrollmentNo",
         COALESCE(jr.message,       '') AS message,
         COUNT(*) OVER()               AS total_count
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       LEFT JOIN LATERAL (
         SELECT dept, year, phone, enrollment_no, message
         FROM   join_requests
         WHERE  club_id = sc.club_id
           AND  email   = u.email
           AND  status  = 'approved'
         ORDER BY updated_at DESC
         LIMIT 1
       ) jr ON true
       ${whereSQL}
       ORDER BY sc.joined_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      members:    rows.map(({ total_count, ...r }) => r),
      count:      total,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* GET /api/clubs/coordinator-assignments?email=X  (admin) */
const getCoordinatorAssignments = async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.json({ assignments: [], user: null });

    const { rows: userRows } = await pgPool.query(
      `SELECT id, name, email, role FROM users WHERE email = $1 AND is_active = true`,
      [email]
    );
    if (!userRows.length) return res.json({ assignments: [], user: null });

    const user = userRows[0];
    const { rows } = await pgPool.query(
      `SELECT cca.id, cca.club_id, cca.is_active, c.name AS club_name, c.category, c.color
       FROM coordinator_club_assignments cca
       JOIN clubs c ON c.id = cca.club_id
       WHERE cca.user_id = $1
       ORDER BY cca.created_at DESC`,
      [user.id]
    );
    res.json({ assignments: rows, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/assign-coordinator  (admin)
   One coordinator → many clubs. A single password in users.password_hash covers
   all clubs. coordinator_club_assignments tracks which clubs they manage.

   BEHAVIOUR:
   • New user  → create account with temp password, send credentials email.
   • Existing user → just add assignment, send confirmation-only email (no password reset).
     This mirrors how students join clubs — they get a confirmation, not new credentials. */
const assignCoordinator = async (req, res, next) => {
  try {
    // Ensure migration (password_hash nullable) has run before inserting
    await ensureSoacTables();
    const { name, email } = req.body;
    const clubId = req.params.id;

    if (!email?.trim()) {
      return res.status(400).json({ message: 'Coordinator email is required.' });
    }
    const emailLower = email.trim().toLowerCase();

    /* Verify the club exists */
    const { rows: clubRows } = await pgPool.query(
      `SELECT ${CLUB_COLS} FROM clubs WHERE id = $1 AND is_active = true`,
      [clubId]
    );
    if (!clubRows.length) return res.status(404).json({ message: 'Club not found.' });
    const club = asClub(clubRows[0]);

    /* Refuse to overwrite an admin account */
    const { rows: existing } = await pgPool.query(
      `SELECT id, name, role FROM users WHERE email = $1`,
      [emailLower]
    );
    if (existing.length && existing[0].role === 'admin') {
      return res.status(409).json({ message: 'This email belongs to an admin account and cannot be used as coordinator.' });
    }

    const coordName = name?.trim() || (existing.length ? existing[0].name : null);
    if (!coordName) {
      return res.status(400).json({ message: 'Coordinator name is required for new accounts.' });
    }

    const isNewUser = !existing.length;
    let userId;
    let tempPassword = null;

    if (isNewUser) {
      /* ── Brand-new account: generate temp password, create user ── */
      tempPassword = crypto.randomBytes(5).toString('hex').toUpperCase();
      const hash   = await bcrypt.hash(tempPassword, 12);
      const { rows: newUser } = await pgPool.query(
        `INSERT INTO users (email, name, role, password_hash, must_change_password, created_by)
         VALUES ($1, $2, 'coordinator', $3, true, $4)
         RETURNING id`,
        [emailLower, coordName, hash, req.user.id]
      );
      userId = newUser[0].id;
    } else {
      /* ── Existing user: activate coordinator role WITHOUT touching their password ── */
      userId = existing[0].id;
      await pgPool.query(
        `UPDATE users
         SET name = $1, role = 'coordinator', is_active = true
         WHERE id = $2`,
        [coordName, userId]
      );
    }

    /* Deactivate any OTHER coordinator currently assigned to this club */
    await pgPool.query(
      `UPDATE coordinator_club_assignments
       SET is_active = false, updated_at = NOW()
       WHERE club_id = $1 AND user_id != $2`,
      [clubId, userId]
    );

    /* Upsert assignment: this coordinator → this club */
    await pgPool.query(
      `INSERT INTO coordinator_club_assignments (user_id, club_id, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, club_id) DO UPDATE
         SET is_active = true, updated_at = NOW()`,
      [userId, clubId]
    );

    /* Legacy FK + frontend fallback: primary club on user row */
    await pgPool.query(
      `UPDATE users SET managed_club_id = $1 WHERE id = $2`,
      [clubId, userId]
    );

    /* Keep the club's coordinator display name in sync */
    await pgPool.query('UPDATE clubs SET coordinator = $1 WHERE id = $2', [coordName, clubId]);

    await logAudit(req.user.id, req.user.name, 'ASSIGN_COORDINATOR', 'club', clubId, {
      coordinatorName: coordName, email: emailLower, clubName: club.name, isNewUser,
    });

    await Promise.all([
      cache.del(`clubs:${clubId}`),
      cache.del(`session:user:${userId}`),
      cache.delPattern('clubs:*'),
    ]);

    /* Send email (non-blocking):
       - New user  → full credentials email with temp password
       - Existing  → confirmation-only email, no password disclosed */
    if (isNewUser) {
      sendCoordinatorCredentials({
        toEmail: emailLower, toName: coordName,
        password: tempPassword, clubName: club.name,
      }).catch(err => console.warn('Coordinator credentials email failed:', err.message));
    } else {
      sendCoordinatorAssignment({
        toEmail: emailLower, toName: coordName, clubName: club.name,
      }).catch(err => console.warn('Coordinator assignment email failed:', err.message));
    }

    res.json({
      isNewUser,
      credentials: {
        name:      coordName,
        email:     emailLower,
        password:  tempPassword,   // null for existing users — no password was reset
        clubName:  club.name,
      },
      message: isNewUser
        ? `Coordinator account created. Credentials sent to ${emailLower}.`
        : `${coordName} added as coordinator of ${club.name}. Confirmation email sent to ${emailLower}.`,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A conflicting assignment already exists.' });
    }
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   COIN LEADERBOARD  (public — no auth required)
   Coins = XP × level multiplier, summed across all clubs per student.
   Multipliers: Beginner=1 · Intermediate=1.5 · Advanced=2 · Expert=3 · Alumni=2
   Returns top 10 globally; top 3 qualify for Free Registration award.
══════════════════════════════════════════════════════════════════════════ */
const getLeaderboard = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const { rows } = await pgPool.query(
      `SELECT
         mp.user_id,
         u.name        AS user_name,
         u.avatar,
         FLOOR(SUM(mp.xp::float * CASE mp.level
           WHEN 'Expert'       THEN 3
           WHEN 'Advanced'     THEN 2
           WHEN 'Alumni'       THEN 2
           WHEN 'Intermediate' THEN 1.5
           ELSE 1
         END))::int    AS coins,
         SUM(mp.xp)::int AS total_xp,
         COUNT(DISTINCT mp.club_id)::int AS club_count
       FROM member_progress mp
       JOIN users u ON u.id = mp.user_id
       WHERE u.is_active = true AND u.role = 'student'
       GROUP BY mp.user_id, u.name, u.avatar
       ORDER BY coins DESC, total_xp DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ leaderboard: rows });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   COINS OVERVIEW  (admin only)
   Returns every active club with its top-3 students ranked by coins,
   plus club-level aggregates. Coins = FLOOR(xp × level multiplier).
══════════════════════════════════════════════════════════════════════════ */
const COIN_MULT = `CASE mp.level
  WHEN 'Expert'       THEN 3
  WHEN 'Advanced'     THEN 2
  WHEN 'Alumni'       THEN 2
  WHEN 'Intermediate' THEN 1.5
  ELSE 1
END`;

const coinsOverview = async (_req, res, next) => {
  try {
    await ensureSoacTables();

    /* All active clubs with member + progress aggregates */
    const { rows: clubs } = await pgPool.query(`
      SELECT
        c.id::text  AS club_id,
        c.name      AS club_name,
        c.color,
        c.logo,
        COUNT(DISTINCT sc.user_id)::int             AS member_count,
        COUNT(DISTINCT mp.user_id)::int             AS tracked_count,
        COALESCE(SUM(mp.xp)::int, 0)               AS total_xp,
        COALESCE(
          FLOOR(SUM(mp.xp::float * ${COIN_MULT}))::int, 0
        )                                           AS total_coins
      FROM clubs c
      LEFT JOIN student_clubs sc ON sc.club_id = c.id
      LEFT JOIN member_progress mp ON mp.club_id = c.id
      WHERE c.is_active = true
      GROUP BY c.id, c.name, c.color, c.logo
      ORDER BY c.name
    `);

    /* Top 3 per club ranked by coins (then xp as tiebreaker) */
    const { rows: top3 } = await pgPool.query(`
      WITH ranked AS (
        SELECT
          mp.club_id::text,
          mp.user_id,
          u.name   AS user_name,
          u.avatar,
          mp.level,
          mp.xp,
          FLOOR(mp.xp::float * ${COIN_MULT})::int AS coins,
          ROW_NUMBER() OVER (
            PARTITION BY mp.club_id
            ORDER BY FLOOR(mp.xp::float * ${COIN_MULT}) DESC, mp.xp DESC, mp.user_id
          ) AS rank
        FROM member_progress mp
        JOIN users u ON u.id = mp.user_id AND u.is_active = true
      )
      SELECT * FROM ranked WHERE rank <= 3
      ORDER BY club_id, rank
    `);

    /* Merge */
    const byClub = {};
    for (const r of top3) {
      if (!byClub[r.club_id]) byClub[r.club_id] = [];
      byClub[r.club_id].push(r);
    }

    const result = clubs.map(c => ({ ...c, top3: byClub[c.club_id] || [] }));

    res.json({
      clubs: result,
      summary: {
        total_clubs:   clubs.length,
        active_clubs:  clubs.filter(c => c.tracked_count > 0).length,
        total_tracked: clubs.reduce((s, c) => s + c.tracked_count, 0),
        total_coins:   clubs.reduce((s, c) => s + c.total_coins, 0),
      },
    });
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create, update, remove, stats, publicStats, seed, mine, getMembers, getAllMembers, assignCoordinator, getCoordinatorAssignments, getLeaderboard, coinsOverview };
