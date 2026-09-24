const slugify = require('slugify');
const { pgPool } = require('../config/db');
const { destroyImage } = require('../config/cloudinary');
const { getFileValue } = require('../config/multer');
const cache      = require('../services/cache');
const { notifyUser, notifyManyUsers } = require('../services/notify');

/* ─── helpers ─────────────────────────────────────────────────────────────── */

/* Must match the categories clubs actually use across the app (club listings,
   admin club form, student propose form). */
const VALID_CATS = ['sports', 'cultural', 'social', 'academic'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Keep only string values (one level of nesting) from the public form's
   free-form `details` payload, trimmed and length-capped, so arbitrary JSON
   can't be stored. */
const cleanDetails = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clip = (v) => String(v).trim().slice(0, 5000);
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 20)) {
    if (typeof v === 'string' && v.trim()) out[k] = clip(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = {};
      for (const [ik, iv] of Object.entries(v).slice(0, 30)) {
        if (typeof iv === 'string' && iv.trim()) inner[ik] = clip(iv);
      }
      if (Object.keys(inner).length) out[k] = inner;
    }
  }
  return out;
};

/* Tell every active admin a new proposal is waiting. Fire-and-forget. */
const notifyAdminsOfProposal = async (proposal) => {
  try {
    const { rows: admins } = await pgPool.query(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = true`,
    );
    if (!admins.length) return;
    await notifyManyUsers({
      userIds: admins.map(a => a.id),
      title:   'New club proposal',
      body:    `${proposal.proposed_by_name || 'Someone'} proposed a new club: "${proposal.club_name}". Review it in Approvals.`,
      type:    'club_proposal',
      url:     '/admin/approvals?tab=proposals',
    });
  } catch (e) { console.error('[clubProposals] notifyAdminsOfProposal failed:', e.message); }
};

/* Tell the proposer (if they have an account) how admin decided. */
const notifyProposer = (proposal, title, body) => {
  if (!proposal.proposed_by_id) return;
  const url = proposal.proposed_by_role === 'student' ? '/student/clubs' : '/';
  notifyUser({ userId: proposal.proposed_by_id, title, body, type: 'club_proposal', url })
    .catch(() => {});
};

const toArray = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split('\n').map(s => s.trim()).filter(Boolean);
  return [];
};

const logoUrl = (filename) => {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;          // Cloudinary URL
  if (/^\d{13}-/.test(filename)) return `/uploads/logos/${filename}`; // legacy local
  return `/logos/${filename}`;                               // seeded asset
};

/* ─── POST /api/club-proposals ────────────────────────────────────────────── */
/* Anyone can submit: logged-in users are identified from their token; guests  */
/* (public /clubs page) must supply applicant_name + applicant_email.          */
const submit = async (req, res, next) => {
  try {
    const {
      club_name, color,
      description, vision, reason,
      tags, rules, schedule, founded_year,
      applicant_name, applicant_email,
    } = req.body;
    const category = String(req.body.category || '').trim().toLowerCase();
    /* The full application form has no separate "reason" field — its objectives
       (sent as vision) are the reason for proposing. */
    const why = reason?.trim() || vision?.trim() || '';

    if (!club_name?.trim())   return res.status(400).json({ message: 'Club name is required.' });
    if (!description?.trim()) return res.status(400).json({ message: 'Description is required.' });
    if (!why)                 return res.status(400).json({ message: 'Reason for proposing is required.' });
    if (!VALID_CATS.includes(category))
      return res.status(400).json({ message: 'Valid category is required.' });

    /* Resolve who is proposing */
    let proposer;
    if (req.user) {
      proposer = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role };
    } else {
      const name  = applicant_name?.trim();
      const email = applicant_email?.trim().toLowerCase();
      if (!name)                          return res.status(400).json({ message: 'Applicant name is required.' });
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ message: 'A valid applicant email is required.' });
      /* Link to an existing account by email so they still hear back in-app */
      const { rows: u } = await pgPool.query(
        `SELECT id, role FROM users WHERE LOWER(email) = $1 LIMIT 1`, [email],
      );
      proposer = { id: u[0]?.id || null, name, email, role: u[0]?.role || 'guest' };
    }

    /* Same person re-submitting the same club while it's still pending */
    const { rows: dup } = await pgPool.query(
      `SELECT id FROM club_proposals
        WHERE status = 'pending' AND LOWER(club_name) = LOWER($1) AND LOWER(proposed_by_email) = LOWER($2)
        LIMIT 1`,
      [club_name.trim(), proposer.email],
    );
    if (dup.length)
      return res.status(409).json({ message: 'You already have a pending proposal for this club. The admin will review it soon.' });

    const { rows } = await pgPool.query(
      `INSERT INTO club_proposals
         (proposed_by_id, proposed_by_name, proposed_by_email, proposed_by_role,
          club_name, category, color, description, vision,
          tags, rules, schedule, founded_year, reason, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        proposer.id,
        proposer.name || '',
        proposer.email || '',
        proposer.role || 'student',
        club_name.trim(),
        category,
        color || '#635BFF',
        description.trim(),
        vision?.trim() || '',
        toArray(tags),
        toArray(rules),
        schedule?.trim() || '',
        founded_year?.trim() || '',
        why,
        JSON.stringify(cleanDetails(req.body.details)),
      ],
    );

    notifyAdminsOfProposal(rows[0]);

    res.status(201).json({ proposal: rows[0], message: 'Proposal submitted successfully.' });
  } catch (err) { next(err); }
};

/* ─── GET /api/club-proposals/:id  (admin) ────────────────────────────────── */
/* Used by the admin Clubs page to pre-fill "Create Club" from a proposal.     */
const getOne = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(`SELECT * FROM club_proposals WHERE id = $1::bigint`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Proposal not found.' });
    res.json({ proposal: rows[0] });
  } catch (err) { next(err); }
};

/* Called by clubs.controller's create, inside its transaction (`db` is the
   transaction client), once admin has created a club from a proposal on the
   Clubs page: marks it approved and links the club. Returns the updated row,
   or null if the proposal was no longer pending. */
const markApprovedWithClub = async (db, { proposalId, clubId, reviewerId }) => {
  const { rows } = await db.query(
    `UPDATE club_proposals
        SET status = 'approved', club_id = $1, reviewed_by = $2,
            reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $3::bigint AND status = 'pending'
      RETURNING *`,
    [clubId, reviewerId, proposalId],
  );
  return rows[0] || null;
};

/* Tell the proposer — call only after the approving transaction commits. */
const notifyProposalApproved = (proposal, clubName) => {
  if (!proposal) return;
  notifyProposer(
    proposal,
    'Club proposal approved 🎉',
    `Your proposal was approved — "${clubName}" is now an official SOAC club.`,
  );
};

/* ─── GET /api/club-proposals/counts  (admin) ─────────────────────────────── */
/* Drives the Approvals sidebar badge and the per-status tab counts.           */
const counts = async (req, res, next) => {
  try {
    const [{ rows: p }, { rows: j }] = await Promise.all([
      pgPool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int  AS pending,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                COUNT(*)::int AS "all"
           FROM club_proposals`,
      ),
      pgPool.query(`SELECT COUNT(*)::int AS pending FROM join_requests WHERE status = 'pending'`),
    ]);
    res.json({ proposals: p[0], joinRequests: { pending: j[0].pending } });
  } catch (err) { next(err); }
};

/* ─── GET /api/club-proposals  (admin) ────────────────────────────────────── */
const list = async (req, res, next) => {
  try {
    const { status } = req.query;
    const values = [];
    const where  = status ? `WHERE status = $${values.push(status)}` : '';

    const { rows } = await pgPool.query(
      `SELECT * FROM club_proposals ${where} ORDER BY created_at DESC`,
      values,
    );
    res.json({ proposals: rows });
  } catch (err) { next(err); }
};

/* ─── POST /api/club-proposals/:id/reject  (admin) ────────────────────────── */
const reject = async (req, res, next) => {
  try {
    const { note } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE club_proposals
         SET status = 'rejected', admin_note = $1,
             reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [note?.trim() || '', req.user.id, req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ message: 'Proposal not found or already reviewed.' });
    notifyProposer(
      rows[0],
      'Club proposal not approved',
      `Your proposal for "${rows[0].club_name}" was not approved.${rows[0].admin_note ? ` Note from admin: ${rows[0].admin_note}` : ''}`,
    );
    res.json({ proposal: rows[0] });
  } catch (err) { next(err); }
};

/* ─── POST /api/club-proposals/:id/approve  (admin, optional logo upload) ─── */
/* Accepts the same form fields as POST /api/clubs so admin can adjust before  */
/* creating. On success: club created, proposal marked approved.                */
const approve = async (req, res, next) => {
  const client = await pgPool.connect();
  let uploadedFile = req.file ? getFileValue(req.file) : null;

  try {
    await client.query('BEGIN');

    /* 1. Fetch proposal */
    const { rows: propRows } = await client.query(
      `SELECT * FROM club_proposals WHERE id = $1 AND status = 'pending'`,
      [req.params.id],
    );
    if (!propRows.length) {
      await client.query('ROLLBACK');
      if (uploadedFile) destroyImage(uploadedFile).catch(() => {});
      return res.status(404).json({ message: 'Proposal not found or already reviewed.' });
    }
    const prop = propRows[0];

    /* 2. Merge proposal defaults with any admin overrides from form body */
    const name        = (req.body.name        || prop.club_name).trim();
    const category    = VALID_CATS.includes(req.body.category) ? req.body.category : prop.category;
    const color       = req.body.color        || prop.color;
    const description = (req.body.description || prop.description).trim();
    const vision      = (req.body.vision      || prop.vision || '').trim();
    const schedule    = (req.body.schedule    || prop.schedule || '').trim();
    const foundedYear = (req.body.founded_year || prop.founded_year || '').trim();
    const tags        = toArray(req.body.tags  || prop.tags);
    const rules       = toArray(req.body.rules || prop.rules);

    if (!name)        { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Club name required.' }); }
    if (!description) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Description required.' }); }

    /* 3. Generate unique slug */
    const base = slugify(name, { lower: true, strict: true });
    let slug = base, n = 1;
    while (true) {                                          // eslint-disable-line no-constant-condition
      const { rows: ex } = await client.query(
        `SELECT id FROM clubs WHERE slug = $1`, [slug],
      );
      if (!ex.length) break;
      slug = `${base}-${n++}`;
    }

    /* 4. Insert club */
    const { rows: clubRows } = await client.query(
      `INSERT INTO clubs
         (name, slug, category, color, logo, description, vision,
          tags, rules, schedule, founded_year, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       RETURNING *`,
      [name, slug, category, color, uploadedFile || '', description, vision,
       tags, rules, schedule, foundedYear],
    );
    const club = clubRows[0];

    /* 5. Mark proposal approved */
    await client.query(
      `UPDATE club_proposals
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, prop.id],
    );

    await client.query('COMMIT');
    await cache.delPattern('clubs:*');
    notifyProposer(
      prop,
      'Club proposal approved 🎉',
      `Your proposal was approved — "${name}" is now an official SOAC club.`,
    );

    res.status(201).json({
      club: {
        ...club,
        _id:    String(club.id),
        logoUrl: logoUrl(club.logo),
      },
      message: `Club "${name}" created from proposal.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (uploadedFile) destroyImage(uploadedFile).catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { submit, list, getOne, counts, reject, approve, markApprovedWithClub, notifyProposalApproved };
