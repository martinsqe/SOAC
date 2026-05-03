const { pgPool } = require('../config/db');
const fs = require('fs');
const path = require('path');
const cache = require('../services/cache');

const FAME_COLS = [
  'id', 'name', 'achievement', 'description', 'term', 'club_id', 'club_name', 'year', 'category',
  'image', 'sort_order', 'is_active', 'created_at', 'updated_at'
].join(', ');

const fameUrl = (filename) => {
  if (!filename) return '';
  return /^\d{13}-/.test(filename)
    ? `/uploads/fame/${filename}`
    : `/images/fame/${filename}`; // fallback for seeded or legacy images
};

const withFameUrl = (row) => ({
  ...row,
  imageUrl: fameUrl(row.image)
});

const logAudit = async (userId, userName, action, entityId, meta = {}) => {
  try {
    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, 'wall_of_fame', $4, $5)`,
      [userId, userName, action, String(entityId), JSON.stringify(meta)]
    );
  } catch (_) {}
};

/* GET /api/fame
   Publicly visible to all logged-in members. */
const getAll = async (req, res, next) => {
  try {
    const cached = await cache.get('fame:all');
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT ${FAME_COLS} FROM wall_of_fame 
       WHERE is_active = true 
       ORDER BY sort_order ASC, created_at DESC`
    );
    
    const result = { items: rows.map(withFameUrl) };
    await cache.set('fame:all', result, 300); // 5 min cache
    res.json(result);
  } catch (err) { next(err); }
};

/* POST /api/fame
   Admin only. */
const create = async (req, res, next) => {
  try {
    const { name, achievement, description, term, club_id, club_name, year, category, sort_order } = req.body;
    const image = req.file ? req.file.filename : '';

    const { rows } = await pgPool.query(
      `INSERT INTO wall_of_fame 
         (name, achievement, description, term, club_id, club_name, year, category, sort_order, image, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${FAME_COLS}`,
      [
        name, achievement, description || '', term || '',
        club_id || null, club_name || '', 
        year || '', category || 'General', 
        parseInt(sort_order) || 0, image, req.user.id
      ]
    );

    const item = withFameUrl(rows[0]);
    await logAudit(req.user.id, req.user.name, 'CREATE_FAME_ITEM', item.id, { name: item.name });
    await cache.del('fame:all');
    res.status(201).json({ item });
  } catch (err) { next(err); }
};

/* PUT /api/fame/:id
   Admin only. */
const update = async (req, res, next) => {
  try {
    const { rows: cur } = await pgPool.query('SELECT image FROM wall_of_fame WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ message: 'Item not found.' });

    const { name, achievement, description, term, club_id, club_name, year, category, sort_order, is_active } = req.body;
    let image = cur[0].image;

    if (req.file) {
      // delete old file if it was an upload
      if (image && /^\d{13}-/.test(image)) {
        const oldPath = path.join(__dirname, '..', 'uploads', 'fame', image);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      image = req.file.filename;
    }

    const { rows } = await pgPool.query(
      `UPDATE wall_of_fame
       SET name        = COALESCE($1, name),
           achievement = COALESCE($2, achievement),
           description = COALESCE($3, description),
           term        = COALESCE($4, term),
           club_id     = $5,
           club_name   = COALESCE($6, club_name),
           year        = COALESCE($7, year),
           category    = COALESCE($8, category),
           sort_order  = COALESCE($9, sort_order),
           is_active   = COALESCE($10, is_active),
           image       = $11,
           updated_at  = NOW()
       WHERE id = $12
       RETURNING ${FAME_COLS}`,
      [
        name, achievement, description, term,
        club_id || null, club_name, 
        year, category, parseInt(sort_order), is_active, 
        image, req.params.id
      ]
    );

    const item = withFameUrl(rows[0]);
    await logAudit(req.user.id, req.user.name, 'UPDATE_FAME_ITEM', item.id, { name: item.name });
    await cache.del('fame:all');
    res.json({ item });
  } catch (err) { next(err); }
};

/* DELETE /api/fame/:id
   Admin only. Soft delete also supported via update, but here we do hard delete if requested.
   Or we can just do soft delete for safety. Let's do soft delete. */
const remove = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      'UPDATE wall_of_fame SET is_active = false WHERE id = $1 RETURNING id, name',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Item not found.' });

    await logAudit(req.user.id, req.user.name, 'DELETE_FAME_ITEM', rows[0].id, { name: rows[0].name });
    await cache.del('fame:all');
    res.json({ message: 'Wall of Fame item removed.' });
  } catch (err) { next(err); }
};

module.exports = { getAll, create, update, remove };
