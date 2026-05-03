const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');

/* ── Row → object ── */
const asEvent = (r) => ({
  id:          String(r.id),
  title:       r.title,
  description: r.description || '',
  startDate:   r.start_date,
  endDate:     r.end_date || null,
  type:        r.type,
  color:       r.color,
  allDay:      r.all_day,
  createdBy:   r.created_by,
  createdAt:   r.created_at,
  updatedAt:   r.updated_at,
});

/* GET /api/calendar
   Query params:
     ?year=2026              → all events for the year
     ?year=2026&month=3      → events for April 2026 (0-based month)
   Both params are optional — omitting returns the current year.           */
const getCalendar = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const year  = parseInt(req.query.year,  10) || new Date().getFullYear();
    const month = req.query.month !== undefined ? parseInt(req.query.month, 10) : null;

    let from, to;
    if (month !== null) {
      from = new Date(year, month, 1);
      to   = new Date(year, month + 1, 0);   // last day of month
    } else {
      from = new Date(year, 0, 1);
      to   = new Date(year, 11, 31);
    }

    const { rows } = await pgPool.query(
      `SELECT * FROM college_calendar
       WHERE start_date BETWEEN $1 AND $2
          OR (end_date IS NOT NULL AND end_date BETWEEN $1 AND $2)
       ORDER BY start_date ASC, title ASC`,
      [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]
    );
    res.json({ events: rows.map(asEvent) });
  } catch (err) { next(err); }
};

/* POST /api/calendar  (admin) */
const createEvent = async (req, res, next) => {
  try {
    const { title, description, start_date, end_date, type, color, all_day } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: 'Title is required.' });
    if (!start_date)    return res.status(400).json({ message: 'Start date is required.' });

    const validTypes = ['event','holiday','exam','deadline','academic'];
    const evType = validTypes.includes(type) ? type : 'event';

    const { rows } = await pgPool.query(
      `INSERT INTO college_calendar
         (title, description, start_date, end_date, type, color, all_day, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        title.trim(),
        description?.trim() || '',
        start_date,
        end_date || null,
        evType,
        color || '#635BFF',
        all_day !== false,
        req.user?.id || null,
      ]
    );
    res.status(201).json({ event: asEvent(rows[0]) });
  } catch (err) { next(err); }
};

/* PUT /api/calendar/:id  (admin) */
const updateEvent = async (req, res, next) => {
  try {
    const { title, description, start_date, end_date, type, color, all_day } = req.body;
    const validTypes = ['event','holiday','exam','deadline','academic'];

    const { rows } = await pgPool.query(
      `UPDATE college_calendar SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         start_date  = COALESCE($3::date, start_date),
         end_date    = $4::date,
         type        = COALESCE($5, type),
         color       = COALESCE($6, color),
         all_day     = COALESCE($7, all_day),
         updated_at  = NOW()
       WHERE id = $8::bigint
       RETURNING *`,
      [
        title?.trim() || null,
        description?.trim() ?? null,
        start_date || null,
        end_date || null,
        (type && validTypes.includes(type)) ? type : null,
        color || null,
        all_day !== undefined ? all_day : null,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Event not found.' });
    res.json({ event: asEvent(rows[0]) });
  } catch (err) { next(err); }
};

/* DELETE /api/calendar/:id  (admin) */
const deleteEvent = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `DELETE FROM college_calendar WHERE id = $1::bigint RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Event not found.' });
    res.json({ message: 'Deleted.' });
  } catch (err) { next(err); }
};

module.exports = { getCalendar, createEvent, updateEvent, deleteEvent };
