const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { pgPool } = require('../config/db');
const { sendCoordinatorCredentials, sendCoordinatorAssignment } = require('../config/email');
const { ensureSoacTables, asClub } = require('../services/soacData');
const { assertCoordOwnsClub, getCoordClubIds } = require('../services/coordAuth');
const { destroyImage } = require('../config/cloudinary');
const { getFileValue } = require('../config/multer');
const cache = require('../services/cache');
const { notifyAdminsOfClubChange } = require('./clubDetail.controller');
const { markApprovedWithClub, notifyProposalApproved } = require('./clubProposals.controller');

/* Longest a staff-assignment request waits on the credentials email before
   responding and letting it finish in the background. */
const STAFF_EMAIL_WAIT_MS = 8000;

/* ── Column list (every column asClub() reads) ─────────────────────────────
   Avoids SELECT * so the result set is predictable regardless of future
   schema additions, and lets the query planner know exactly what to fetch. */
const CLUB_COLS = [
  'id', 'name', 'slug', 'category', 'color', 'logo', 'coordinator', 'faculty_coordinator',
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
  if (filename.startsWith('http')) return filename;         // Cloudinary URL
  if (/^\d{13}-/.test(filename)) return `/uploads/logos/${filename}`; // legacy local
  return `/logos/${filename}`;                              // seeded asset
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
              (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = clubs.id AND is_active = true) AS real_member_count,
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
              (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = clubs.id AND is_active = true) AS real_member_count,
              (SELECT COUNT(*)::int FROM events WHERE club = clubs.name AND is_active = true) AS real_event_count,
              (SELECT u.avatar FROM coordinator_club_assignments cca
               JOIN users u ON u.id = cca.user_id AND u.role = 'coordinator'
               WHERE cca.club_id = clubs.id AND cca.is_active = true
               ORDER BY cca.id ASC LIMIT 1) AS coordinator_avatar,
              (SELECT u.avatar FROM coordinator_club_assignments cca
               JOIN users u ON u.id = cca.user_id AND u.role = 'faculty_coordinator'
               WHERE cca.club_id = clubs.id AND cca.is_active = true
               ORDER BY cca.id ASC LIMIT 1) AS faculty_coordinator_avatar
       FROM clubs WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Club not found.' });

    const club = asClub(rows[0]);
    club.memberCount            = rows[0].real_member_count;
    club.eventCount             = rows[0].real_event_count;
    club.coordinatorAvatar      = rows[0].coordinator_avatar || null;
    club.facultyCoordinatorAvatar = rows[0].faculty_coordinator_avatar || null;
    const result = { club: withLogoUrl(club) };
    await cache.set(cacheKey, result, cache.TTL.CLUB);
    res.json(result);
  } catch (err) { next(err); }
};

/* POST /api/clubs  (admin)
   Optionally takes fcName/fcEmail and/or scName/scEmail to assign the club's
   Faculty Coordinator and/or Student Coordinator in the same step, through
   the exact same performStaffAssignment() the dedicated Assign FC/SC modals
   use — same account creation-or-reuse logic, same credentials email, same
   coordinator_club_assignments row — so a club created with staff already
   named is indistinguishable from one assigned afterward the usual way. A
   club that fails to save is never created (existing behaviour, unchanged);
   a bad FC/SC email, once the club itself exists, is reported back instead
   of rolling the whole club back — admin can always assign it afterward
   from the club card the ordinary way. */
const create = async (req, res, next) => {
  const {
    name, category, color, coordinator, foundedYear, memberCount, eventCount, description, tags,
    fcName, fcEmail, scName, scEmail,
    /* Set when admin is creating this club from a submitted club proposal */
    proposalId, vision, schedule, rules,
  } = req.body;
  const logo = getFileValue(req.file) ?? '';
  /* Only when creating from a proposal: one transaction that locks the
     proposal row, inserts the club and marks the proposal approved — so two
     submits (double-click, two admins, a network retry) can never create two
     clubs, and a failed insert never leaves the proposal marked approved. */
  let tx = null;
  let approvedProposal = null;

  try {
    await ensureSoacTables();
    if (!name?.trim()) {
      if (logo) destroyImage(logo).catch(() => {});
      return res.status(400).json({ message: 'Club name is required.' });
    }

    if (proposalId) {
      tx = await pgPool.connect();
      await tx.query('BEGIN');
      const { rows: prop } = await tx.query(
        `SELECT p.status, p.club_name, c.name AS created_club_name
           FROM club_proposals p
           LEFT JOIN clubs c ON c.id = p.club_id
          WHERE p.id = $1::bigint
          FOR UPDATE OF p`,
        [proposalId],
      );
      if (prop[0]?.status !== 'pending') {
        await tx.query('ROLLBACK');
        tx.release();
        tx = null;
        if (logo) destroyImage(logo).catch(() => {});
        const p = prop[0];
        const message = !p
          ? 'This proposal no longer exists.'
          : p.status === 'approved'
            ? `This proposal was already approved${p.created_club_name ? ` — the club "${p.created_club_name}" exists under All Clubs` : ''}.`
            : 'This proposal was rejected, so a club can no longer be created from it.';
        return res.status(409).json({ message, alreadyApproved: p?.status === 'approved' });
      }
    }
    const db = tx || pgPool;

    /* Unique slug — a proposed name can easily collide with an existing club */
    const base = slugify(name, { lower: true, strict: true }) || 'club';
    let slug = base;
    for (let n = 1; ; n++) {
      const { rows: taken } = await db.query(`SELECT 1 FROM clubs WHERE slug = $1`, [slug]);
      if (!taken.length) break;
      slug = `${base}-${n}`;
    }

    const { rows } = await db.query(
      `INSERT INTO clubs
       (name, slug, category, color, coordinator, founded_year, member_count, event_count, description, tags, logo,
        vision, schedule, rules)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${CLUB_COLS}`,
      [
        name.trim(), slug,
        category, color || '#635BFF', coordinator || '',
        foundedYear || '', Number(memberCount) || 0, Number(eventCount) || 0,
        description || '', tags ? JSON.parse(tags) : [], logo,
        vision?.trim() || '', schedule?.trim() || '',
        (rules || '').split('\n').map(r => r.trim()).filter(Boolean),
      ]
    );
    let club = asClub(rows[0]);

    if (tx) {
      approvedProposal = await markApprovedWithClub(tx, {
        proposalId, clubId: club.id, reviewerId: req.user.id,
      });
      await tx.query('COMMIT');
      tx.release();
      tx = null;
      notifyProposalApproved(approvedProposal, club.name);
    }

    await logAudit(req.user.id, req.user.name, 'CREATE_CLUB', 'club', club.id, { name, proposalId: proposalId || undefined });
    await Promise.all([cache.delPattern('clubs:*'), cache.del('stats:admin')]);

    const staff = {};
    if (fcEmail?.trim()) {
      staff.fc = await performStaffAssignment({
        role: 'faculty_coordinator', clubId: club.id, name: fcName, email: fcEmail,
        actorUserId: req.user.id, actorName: req.user.name,
      });
    }
    if (scEmail?.trim()) {
      staff.sc = await performStaffAssignment({
        role: 'coordinator', clubId: club.id, name: scName, email: scEmail,
        actorUserId: req.user.id, actorName: req.user.name,
      });
    }

    /* Re-read the club if either assignment touched its coordinator/
       faculty_coordinator display columns, so the response reflects them. */
    if (staff.fc?.ok || staff.sc?.ok) {
      const { rows: freshRows } = await pgPool.query(`SELECT ${CLUB_COLS} FROM clubs WHERE id = $1`, [club.id]);
      club = asClub(freshRows[0]);
    }

    const staffResult = (r) => r && {
      ok: r.ok, message: r.message, credentials: r.credentials,
      emailSent: r.emailSent, emailPending: r.emailPending,
    };
    res.status(201).json({
      club: withLogoUrl(club),
      proposalApproved: !!approvedProposal,
      fc: staffResult(staff.fc),
      sc: staffResult(staff.sc),
    });
  } catch (err) {
    if (tx) {
      await tx.query('ROLLBACK').catch(() => {});
      tx.release();
      if (logo) destroyImage(logo).catch(() => {});
    }
    next(err);
  }
};

/* PUT /api/clubs/:id  (admin) */
const update = async (req, res, next) => {
  try {
    const { rows: cur } = await pgPool.query(
      `SELECT id, name, logo, category, color, coordinator, founded_year, description, tags FROM clubs WHERE id = $1`,
      [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ message: 'Club not found.' });
    const current = cur[0];

    const { name, category, color, coordinator, foundedYear, memberCount, eventCount, description, tags } = req.body;
    const nextLogo  = req.file ? getFileValue(req.file) : current.logo;
    if (req.file) await destroyImage(current.logo);
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

    /* Build a before/after diff for the audit trail */
    const changes = [];
    const fieldLabels = {
      name: 'Name', category: 'Category', color: 'Color', coordinator: 'Coordinator',
      founded_year: 'Founded Year', description: 'Description', tags: 'Tags',
    };
    const candidates = {
      name:         name         !== undefined ? finalName            : undefined,
      category:     category     !== undefined ? category             : undefined,
      color:        color        !== undefined ? color                : undefined,
      coordinator:  coordinator  !== undefined ? coordinator          : undefined,
      founded_year: foundedYear  !== undefined ? String(foundedYear)  : undefined,
      description:  description  !== undefined ? description          : undefined,
      tags:         tags         !== undefined ? JSON.parse(tags)     : undefined,
    };
    for (const [key, newVal] of Object.entries(candidates)) {
      if (newVal === undefined) continue;
      const oldRaw = current[key];
      const oldStr = Array.isArray(oldRaw) ? oldRaw.join(', ') : String(oldRaw ?? '');
      const newStr = Array.isArray(newVal) ? newVal.join(', ') : String(newVal ?? '');
      if (oldStr !== newStr) changes.push({ field: fieldLabels[key] || key, from: oldStr, to: newStr });
    }
    if (req.file) changes.push({ field: 'Logo', from: null, to: 'updated' });

    await logAudit(req.user.id, req.user.name, 'UPDATE_CLUB', 'club', club.id, { name: club.name, changes });
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
      `SELECT id, name, slug, logo FROM clubs WHERE id = $1`,
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

    /* 3. Record slug so autoSeed never re-creates this club on future deploys */
    await client.query(
      `INSERT INTO seed_exclusions (slug) VALUES ($1) ON CONFLICT DO NOTHING`,
      [club.slug]
    );

    /* 4. Hard-delete the club row.
          All tables with ON DELETE CASCADE FK clean up automatically:
          join_requests, student_clubs, club_announcements,
          club_leadership, club_messages, club_tasks,
          club_attendance_sessions (→ records cascade),
          member_progress, event_requests */
    await client.query(`DELETE FROM clubs WHERE id = $1`, [req.params.id]);

    await client.query('COMMIT');

    /* 4. Delete logo from Cloudinary (fire-and-forget) */
    if (club.logo) destroyImage(club.logo).catch(() => {});

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
   Used for landing page hero counters and category counts */
const publicStats = async (req, res, next) => {
  try {
    const [cRes, mRes, eRes, catRes] = await Promise.all([
      pgPool.query(`SELECT COUNT(*)::int AS count FROM clubs WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM student_clubs WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM events WHERE is_active = true`),
      pgPool.query(`SELECT category, COUNT(*)::int AS count FROM clubs WHERE is_active = true GROUP BY category ORDER BY category`),
    ]);
    const byCategory = {};
    catRes.rows.forEach(r => { byCategory[r.category] = r.count; });
    res.json({
      clubs:      cRes.rows[0].count,
      members:    mRes.rows[0].count,
      events:     eRes.rows[0].count,
      byCategory,
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
      (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = clubs.id AND is_active = true) AS real_member_count,
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
    if (req.user?.role === 'coordinator' || req.user?.role === 'faculty_coordinator') {
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
         sc.is_active       AS "membershipActive",
         sc.deactivated_at  AS "deactivatedAt",
         u.name,
         u.email,
         u.is_active,
         COALESCE(jr.dept,          '') AS dept,
         COALESCE(jr.year,          '') AS year,
         COALESCE(jr.phone,         '') AS phone,
         COALESCE(jr.enrollment_no, '') AS "enrollmentNo",
         COALESCE(jr.gender,        '') AS gender,
         COALESCE(jr.message,       '') AS message,
         COUNT(*) OVER()               AS total_count
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       LEFT JOIN LATERAL (
         SELECT dept, year, phone, enrollment_no, gender, message
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
      filterClauses.push(`COALESCE(profile.dept, '') = $${values.length}`);
    }
    if (year) {
      values.push(year);
      filterClauses.push(`COALESCE(profile.year, '') = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      filterClauses.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR COALESCE(profile.enrollment_no,'') ILIKE $${idx})`);
    }

    const whereSQL = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';
    values.push(limit, offset);

    const { rows } = await pgPool.query(
      `SELECT
         sc.user_id   AS id,
         sc.club_id,
         sc.club_name,
         sc.joined_at,
         sc.is_active       AS "membershipActive",
         sc.deactivated_at  AS "deactivatedAt",
         u.name,
         u.email,
         u.is_active,
         COALESCE(profile.dept,          '') AS dept,
         COALESCE(profile.year,          '') AS year,
         COALESCE(profile.phone,         '') AS phone,
         COALESCE(profile.enrollment_no, '') AS "enrollmentNo",
         COALESCE(profile.gender,        '') AS gender,
         COALESCE(thisClubMsg.message,   '') AS message,
         COUNT(*) OVER()               AS total_count
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       /* Phone/dept/enrollment/gender/year are facts about the STUDENT, not
          about this specific membership — scoping the lookup to club_id =
          sc.club_id meant a student added to a club by any path other than
          that exact club's own approved join request (e.g. an approved
          request for a different club, then reassigned/added elsewhere)
          showed blank contact info here even though the platform has their
          real details on file. Match by email only, across every club they
          ever applied to; prefer an approved request but fall back to any
          status, since even a pending/declined one still has real answers. */
       LEFT JOIN LATERAL (
         SELECT dept, year, phone, enrollment_no, gender
         FROM   join_requests
         WHERE  email = u.email
         ORDER BY (status = 'approved') DESC, updated_at DESC
         LIMIT 1
       ) profile ON true
       /* The "why do you want to join" message, in contrast, genuinely is
          specific to this exact club — only shown when it was actually
          written for this membership's own approved request. */
       LEFT JOIN LATERAL (
         SELECT message
         FROM   join_requests
         WHERE  club_id = sc.club_id
           AND  email   = u.email
           AND  status  = 'approved'
         ORDER BY updated_at DESC
         LIMIT 1
       ) thisClubMsg ON true
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

/* PATCH /api/clubs/:id/members/:userId/toggle-active  (coordinator of this club, or admin)
   Deactivates or reactivates a student's membership in THIS club specifically — the
   student_clubs row is never deleted (joined_at/deactivated_at stay on record), the
   student's platform login (users.is_active) and any other club memberships are untouched,
   and a deactivated slot no longer counts toward their 3-club cap so they're free to join
   somewhere else. Toggling back to active (e.g. undoing a mistake) clears deactivated_at/by. */
const toggleMemberActive = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `UPDATE student_clubs
       SET is_active      = NOT is_active,
           deactivated_at = CASE WHEN is_active THEN NOW() ELSE NULL END,
           deactivated_by = CASE WHEN is_active THEN $3::int ELSE NULL END
       WHERE club_id = $1::bigint AND user_id = $2::int
       RETURNING user_id, club_id, is_active, deactivated_at`,
      [req.params.id, req.params.userId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Membership not found.' });
    const membership = rows[0];

    /* Resync the displayed member count from the real active-row count */
    await pgPool.query(
      `UPDATE clubs
       SET member_count = (SELECT COUNT(*)::int FROM student_clubs WHERE club_id = $1 AND is_active = true),
           updated_at   = NOW()
       WHERE id = $1`,
      [req.params.id]
    );

    await logAudit(
      req.user.id, req.user.name,
      membership.is_active ? 'REACTIVATE_MEMBER' : 'DEACTIVATE_MEMBER',
      'student_club', req.params.userId, { clubId: req.params.id }
    );

    await Promise.all([
      cache.del(`clubs:${req.params.id}`),
      cache.delPattern(`clubs:${req.params.id}:members*`),
      cache.delPattern('clubs:*'),
      cache.del(`student:${req.params.userId}`),
    ]);

    res.json({
      message: membership.is_active ? 'Member reactivated.' : 'Member deactivated.',
      membershipActive: membership.is_active,
      deactivatedAt: membership.deactivated_at,
    });
  } catch (err) { next(err); }
};

/* GET /api/clubs/coordinator-assignments?email=X  (admin, or a Faculty Coordinator
   looking up an email before assigning them as their club's Student Coordinator) */
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
    res.json({ assignments: rows, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { next(err); }
};

/* ── Club staff role assignment (Coordinator / Faculty Coordinator) ─────────
   Both roles share the exact same mechanics — one account → many clubs, a
   single password in users.password_hash, coordinator_club_assignments
   tracking which clubs they manage — so both assign-* endpoints below are
   thin wrappers around this one function, parameterised by role.
     • New user      → create account with temp password, send credentials email.
     • Existing user → just add the assignment, send confirmation-only email
       (no password reset) — mirrors how students join clubs.
   Deactivating "any other X currently assigned to this club" is scoped to
   users of the SAME role, so assigning a new Student Coordinator never
   touches that club's Faculty Coordinator, and vice versa — both can be
   active on one club at once, unlike the old single-coordinator model. */
const ROLE_META = {
  coordinator: {
    label: 'Coordinator', roleLabel: 'Student Coordinator',
    auditAction: 'ASSIGN_COORDINATOR', clubNameCol: 'coordinator',
    blockedRoles: { admin: 'admin', faculty_coordinator: 'Faculty Coordinator' },
  },
  faculty_coordinator: {
    label: 'Faculty Coordinator', roleLabel: 'Faculty Coordinator',
    auditAction: 'ASSIGN_FACULTY_COORDINATOR', clubNameCol: 'faculty_coordinator',
    /* An existing Student Coordinator is NOT blocked here — see promoteRole
       below. Only admin accounts are refused outright. */
    blockedRoles: { admin: 'admin' },
    promoteFrom: 'coordinator',
  },
};

/* Core assignment logic, lifted out of the route handler below so club
   creation can call it too (see create()) — assigning FC/SC in the same
   step a club is created, rather than requiring two more round trips
   through the separate Assign modals afterward. Returns a plain result
   object instead of touching res, so either caller can decide how to
   respond. Never throws for an expected/validation failure — those come
   back as { ok: false, status, message } so a bad FC/SC email at
   creation time reports back clearly without rolling back the club
   itself, which by that point already exists. */
const performStaffAssignment = async ({ role, clubId, name, email, actorUserId, actorName }) => {
  await ensureSoacTables();
  const meta = ROLE_META[role];

  if (!email?.trim()) {
    return { ok: false, status: 400, message: `${meta.label} email is required.` };
  }
  const emailLower = email.trim().toLowerCase();

  const { rows: clubRows } = await pgPool.query(
    `SELECT ${CLUB_COLS} FROM clubs WHERE id = $1 AND is_active = true`,
    [clubId]
  );
  if (!clubRows.length) return { ok: false, status: 404, message: 'Club not found.' };
  const club = asClub(clubRows[0]);

  /* Refuse to overwrite an admin account, or the club's other staff role */
  const { rows: existing } = await pgPool.query(
    `SELECT id, name, role FROM users WHERE email = $1`,
    [emailLower]
  );
  if (existing.length && meta.blockedRoles[existing[0].role]) {
    return {
      ok: false, status: 409,
      message: `This email belongs to a${meta.blockedRoles[existing[0].role] === 'admin' ? 'n' : ''} ${meta.blockedRoles[existing[0].role]} account and cannot be used as ${meta.label}.`,
    };
  }

  const staffName = name?.trim() || (existing.length ? existing[0].name : null);
  if (!staffName) {
    return { ok: false, status: 400, message: `${meta.label} name is required for new accounts.` };
  }

  const isNewUser  = !existing.length;
  /* Promotion: this email is currently the Student Coordinator of one or more
     clubs and is being appointed Faculty Coordinator instead. Since a user has
     exactly one role account-wide (assignment rows carry no role of their own —
     it's inferred by joining users.role), they cannot remain SC anywhere once
     promoted, or every one of those clubs would silently gain them as FC too the
     next time anything queries by role. So promotion revokes their Student
     Coordinator standing everywhere, not just on the club being assigned here —
     "they can no longer access the Student Coordinator dashboard" — and, like a
     brand-new account, issues a fresh temporary password rather than leaving
     their old one in place. */
  const isPromotion = !isNewUser && !!meta.promoteFrom && existing[0].role === meta.promoteFrom;
  const issueNewCredentials = isNewUser || isPromotion;
  let userId;
  let tempPassword = null;

  if (isPromotion) {
    const { rows: priorClubs } = await pgPool.query(
      `SELECT club_id FROM coordinator_club_assignments WHERE user_id = $1 AND is_active = true`,
      [existing[0].id]
    );
    if (priorClubs.length) {
      await pgPool.query(
        `UPDATE clubs SET coordinator = '' WHERE id = ANY($1::bigint[])`,
        [priorClubs.map(r => r.club_id)]
      );
      await pgPool.query(
        `UPDATE coordinator_club_assignments SET is_active = false, updated_at = NOW() WHERE user_id = $1`,
        [existing[0].id]
      );
    }
  }

  if (isNewUser) {
    /* ── Brand-new account: generate temp password, create user ── */
    tempPassword = crypto.randomBytes(5).toString('hex').toUpperCase();
    const hash   = await bcrypt.hash(tempPassword, 12);
    const { rows: newUser } = await pgPool.query(
      `INSERT INTO users (email, name, role, password_hash, must_change_password, created_by)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING id`,
      [emailLower, staffName, role, hash, actorUserId]
    );
    userId = newUser[0].id;
  } else if (isPromotion) {
    /* ── Promoted existing account: new role AND a fresh temp password ── */
    tempPassword = crypto.randomBytes(5).toString('hex').toUpperCase();
    const hash   = await bcrypt.hash(tempPassword, 12);
    userId = existing[0].id;
    await pgPool.query(
      `UPDATE users SET name = $1, role = $2, is_active = true, password_hash = $3, must_change_password = true WHERE id = $4`,
      [staffName, role, hash, userId]
    );
  } else {
    /* ── Existing user: activate this role WITHOUT touching their password ── */
    userId = existing[0].id;
    await pgPool.query(
      `UPDATE users SET name = $1, role = $2, is_active = true WHERE id = $3`,
      [staffName, role, userId]
    );
  }

  /* Deactivate any OTHER user of this SAME role currently assigned to this club */
  await pgPool.query(
    `UPDATE coordinator_club_assignments cca
     SET is_active = false, updated_at = NOW()
     FROM users u
     WHERE cca.user_id = u.id AND cca.club_id = $1 AND cca.user_id != $2 AND u.role = $3`,
    [clubId, userId, role]
  );

  /* Upsert assignment: this person → this club */
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

  /* Keep the club's display name for this role in sync */
  await pgPool.query(`UPDATE clubs SET ${meta.clubNameCol} = $1 WHERE id = $2`, [staffName, clubId]);

  await logAudit(actorUserId, actorName, meta.auditAction, 'club', clubId, {
    staffName, email: emailLower, clubName: club.name, isNewUser, isPromotion,
  });

  await Promise.all([
    cache.del(`clubs:${clubId}`),
    cache.del(`session:user:${userId}`),
    cache.delPattern('clubs:*'),
  ]);

  /* Send email — wait a bounded time so we can usually report success/failure,
     but never hold the response hostage to a slow mail provider (its own
     retries/fallbacks can take minutes). If it isn't done in time it keeps
     sending in the background and we report it as pending — the admin is
     shown the credentials either way. */
  let emailError = null;
  const emailPromise = (issueNewCredentials
    ? sendCoordinatorCredentials({
        toEmail: emailLower, toName: staffName,
        password: tempPassword, clubName: club.name, roleLabel: meta.roleLabel,
      })
    : sendCoordinatorAssignment({
        toEmail: emailLower, toName: staffName, clubName: club.name, roleLabel: meta.roleLabel,
      })
  ).then(
    () => true,
    (err) => { emailError = err.message; console.warn(`${meta.label} email failed:`, err.message); return false; },
  );
  const emailResult = await Promise.race([
    emailPromise,
    new Promise(resolve => setTimeout(() => resolve('pending'), STAFF_EMAIL_WAIT_MS)),
  ]);
  const emailPending = emailResult === 'pending';
  const emailSent    = emailPending ? null : emailResult;

  return {
    ok: true,
    isNewUser,
    isPromotion,
    emailSent,
    emailPending,
    emailError: emailError || undefined,
    staffName,
    credentials: {
      name:      staffName,
      email:     emailLower,
      password:  tempPassword,
      clubName:  club.name,
    },
    message: isPromotion
      ? `${staffName} was promoted to Faculty Coordinator of ${club.name} — their Student Coordinator access has been revoked${emailSent ? ` and new login credentials were sent to ${emailLower}` : emailPending ? ` — new login credentials are being emailed to ${emailLower}` : ', but the credentials email could not be sent — share the new password manually'}.`
      : isNewUser
      ? `${meta.label} account created${emailSent ? `. Credentials sent to ${emailLower}` : emailPending ? `. Credentials are being emailed to ${emailLower}` : ' — email could not be sent, share credentials manually'}.`
      : `${staffName} added as ${meta.label.toLowerCase()} of ${club.name}${emailSent ? `. Confirmation sent to ${emailLower}` : emailPending ? `. Confirmation is being emailed to ${emailLower}` : ' — email could not be sent'}.`,
  };
};

const assignClubStaff = (role) => async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const result = await performStaffAssignment({
      role, clubId: req.params.id, name, email,
      actorUserId: req.user.id, actorName: req.user.name,
    });
    if (!result.ok) return res.status(result.status).json({ message: result.message });

    const { ok, status, staffName, ...responseBody } = result;
    res.json(responseBody);

    /* Only ever fires for a Student Coordinator change made by that club's own
       Faculty Coordinator — admin assigning either role doesn't need to notify
       itself, and notifyAdminsOfClubChange already no-ops for an admin actor. */
    if (role === 'coordinator') {
      notifyAdminsOfClubChange(req, req.params.id, `set ${staffName} as the Student Coordinator`).catch(() => {});
    }
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A conflicting assignment already exists.' });
    }
    next(err);
  }
};

/* POST /api/clubs/:id/assign-coordinator  (admin, or that club's own Faculty
   Coordinator — see requireAdminOrOwningFC in clubs.routes.js) */
const assignCoordinator = assignClubStaff('coordinator');

/* POST /api/clubs/:id/assign-fc  (admin only) */
const assignFacultyCoordinator = assignClubStaff('faculty_coordinator');

module.exports = { getAll, getOne, create, update, remove, stats, publicStats, seed, mine, getMembers, getAllMembers, toggleMemberActive, assignCoordinator, assignFacultyCoordinator, getCoordinatorAssignments };
