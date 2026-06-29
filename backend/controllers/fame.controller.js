const { pgPool } = require('../config/db');
const { destroyImage } = require('../config/cloudinary');
const { getFileValue } = require('../config/multer');
const cache = require('../services/cache');

const FAME_COLS = [
  'id', 'name', 'achievement', 'description', 'term', 'club_id', 'club_name', 'year', 'category',
  'image', 'gallery', 'email', 'enrollment_number', 'sort_order', 'is_active', 'created_at', 'updated_at',
].join(', ');

// Idempotent migrations
pgPool.query(`ALTER TABLE wall_of_fame ADD COLUMN IF NOT EXISTS gallery           JSONB        DEFAULT '[]'::jsonb`).catch(() => {});
pgPool.query(`ALTER TABLE wall_of_fame ADD COLUMN IF NOT EXISTS email             VARCHAR(255) DEFAULT NULL`).catch(() => {});
pgPool.query(`ALTER TABLE wall_of_fame ADD COLUMN IF NOT EXISTS enrollment_number VARCHAR(50)  DEFAULT NULL`).catch(() => {});

const parseGallery = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; }
    catch { return []; }
  }
  return [];
};

const fameUrl = (filename) => {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  if (/^\d{13}-/.test(filename)) return `/uploads/fame/${filename}`;
  return `/images/fame/${filename}`;
};

const withFameUrl = (row) => ({
  ...row,
  imageUrl: fameUrl(row.image),
  gallery: parseGallery(row.gallery),
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

/* POST /api/fame — admin only */
const create = async (req, res, next) => {
  try {
    const { name, achievement, description, term, club_id, club_name, year, category, sort_order, email, enrollment_number } = req.body;
    const image   = getFileValue(req.files?.image?.[0]) ?? '';
    const gallery = (req.files?.gallery ?? []).slice(0, 4).map(f => getFileValue(f));

    const cleanEmail = email?.trim().toLowerCase() || null;
    const cleanEnrol = enrollment_number?.trim().toUpperCase() || null;

    const { rows } = await pgPool.query(
      `INSERT INTO wall_of_fame
         (name, achievement, description, term, club_id, club_name, year, category, sort_order, image, gallery, email, enrollment_number, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${FAME_COLS}`,
      [
        name, achievement, description || '', term || '',
        club_id || null, club_name || '',
        year || '', category || 'General',
        parseInt(sort_order) || 0,
        image, JSON.stringify(gallery),
        cleanEmail, cleanEnrol, req.user.id,
      ]
    );

    const item = withFameUrl(rows[0]);
    await logAudit(req.user.id, req.user.name, 'CREATE_FAME_ITEM', item.id, { name: item.name });
    await cache.del('fame:all');

    // Notify the student if their RKU email maps to a registered user
    if (cleanEmail) {
      try {
        const { rows: uRows } = await pgPool.query(
          `SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
          [cleanEmail]
        );
        if (uRows.length) {
          await pgPool.query(
            `INSERT INTO member_notifications (user_id, title, body, type)
             VALUES ($1, $2, $3, 'wall_of_fame')`,
            [
              uRows[0].id,
              "You're on the Wall of Fame!",
              `Honored for "${achievement}". Your excellence is now a permanent part of RK University's legacy — a moment you've truly earned.`,
            ]
          );
        }
      } catch (_) {}
    }

    res.status(201).json({ item });
  } catch (err) { next(err); }
};

/* PUT /api/fame/:id — admin only */
const update = async (req, res, next) => {
  try {
    const { rows: cur } = await pgPool.query(
      'SELECT image, gallery FROM wall_of_fame WHERE id = $1',
      [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ message: 'Item not found.' });

    const existingGallery = parseGallery(cur[0].gallery);
    const { name, achievement, description, term, club_id, club_name, year, category, sort_order, is_active, keep_gallery, email, enrollment_number } = req.body;
    const cleanEmail = email?.trim().toLowerCase() || null;
    const cleanEnrol = enrollment_number?.trim().toUpperCase() || null;

    // Cover photo: replace only when a new file is uploaded
    let image = cur[0].image;
    if (req.files?.image?.[0]) {
      await destroyImage(image).catch(() => {});
      image = getFileValue(req.files.image[0]);
    }

    // Gallery: kept existing URLs + new uploads, capped at 5
    const keepUrls = parseGallery(keep_gallery);
    const newFiles  = (req.files?.gallery ?? []).map(f => getFileValue(f));
    const merged    = [...keepUrls, ...newFiles].slice(0, 5);

    // Destroy Cloudinary images removed from the gallery
    const removed = existingGallery.filter(url => !keepUrls.includes(url));
    await Promise.all(removed.map(url => destroyImage(url).catch(() => {})));

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
           image             = $11,
           gallery           = $12,
           email             = COALESCE($13, email),
           enrollment_number = COALESCE($14, enrollment_number),
           updated_at        = NOW()
       WHERE id = $15
       RETURNING ${FAME_COLS}`,
      [
        name, achievement, description, term,
        club_id || null, club_name,
        year, category, parseInt(sort_order), is_active,
        image, JSON.stringify(merged),
        cleanEmail, cleanEnrol, req.params.id,
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
