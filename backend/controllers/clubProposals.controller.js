const path    = require('path');
const fs      = require('fs');
const slugify = require('slugify');
const { pgPool } = require('../config/db');
const cache      = require('../services/cache');

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const VALID_CATS = ['tech', 'sports', 'cultural', 'health', 'community'];

const toArray = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split('\n').map(s => s.trim()).filter(Boolean);
  return [];
};

const deleteFile = (filename, subdir) => {
  if (!filename) return;
  const fp = path.join(__dirname, '..', 'uploads', subdir, filename);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
};

const logoUrl = (filename) => {
  if (!filename) return '';
  return /^\d{13}-/.test(filename)
    ? `/uploads/logos/${filename}`
    : `/logos/${filename}`;
};

/* ─── POST /api/club-proposals ────────────────────────────────────────────── */
/* Any authenticated user (student, coordinator) can submit.                   */
const submit = async (req, res, next) => {
  try {
    const {
      club_name, category, color,
      description, vision, reason,
      tags, rules, schedule, founded_year,
    } = req.body;

    if (!club_name?.trim())   return res.status(400).json({ message: 'Club name is required.' });
    if (!description?.trim()) return res.status(400).json({ message: 'Description is required.' });
    if (!reason?.trim())      return res.status(400).json({ message: 'Reason for proposing is required.' });
    if (!category || !VALID_CATS.includes(category))
      return res.status(400).json({ message: 'Valid category is required.' });

    const { rows } = await pgPool.query(
      `INSERT INTO club_proposals
         (proposed_by_id, proposed_by_name, proposed_by_email, proposed_by_role,
          club_name, category, color, description, vision,
          tags, rules, schedule, founded_year, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.user.id,
        req.user.name,
        req.user.email,
        req.user.role,
        club_name.trim(),
        category,
        color || '#635BFF',
        description.trim(),
        vision?.trim() || '',
        toArray(tags),
        toArray(rules),
        schedule?.trim() || '',
        founded_year?.trim() || '',
        reason.trim(),
      ],
    );

    res.status(201).json({ proposal: rows[0], message: 'Proposal submitted successfully.' });
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
    res.json({ proposal: rows[0] });
  } catch (err) { next(err); }
};

/* ─── POST /api/club-proposals/:id/approve  (admin, optional logo upload) ─── */
/* Accepts the same form fields as POST /api/clubs so admin can adjust before  */
/* creating. On success: club created, proposal marked approved.                */
const approve = async (req, res, next) => {
  const client = await pgPool.connect();
  let uploadedFile = req.file?.filename || null;

  try {
    await client.query('BEGIN');

    /* 1. Fetch proposal */
    const { rows: propRows } = await client.query(
      `SELECT * FROM club_proposals WHERE id = $1 AND status = 'pending'`,
      [req.params.id],
    );
    if (!propRows.length) {
      await client.query('ROLLBACK');
      if (uploadedFile) deleteFile(uploadedFile, 'logos');
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
    if (uploadedFile) deleteFile(uploadedFile, 'logos');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { submit, list, reject, approve };
