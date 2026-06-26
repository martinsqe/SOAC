const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds, assertCoordOwnsClub } = require('../services/coordAuth');

/* ── POST /api/event-requests  (coordinator submits proposal) ── */
const createRequest = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const {
      title, description, category, date, start_date,
      time, venue, seats, tags, highlight, registration_url,
      is_free, fee_amount,
    } = req.body;

    if (!title?.trim())       return res.status(400).json({ message: 'Event title is required.' });
    if (!description?.trim()) return res.status(400).json({ message: 'Description is required.' });
    if (!venue?.trim())       return res.status(400).json({ message: 'Venue is required.' });
    if (!start_date)          return res.status(400).json({ message: 'Event date is required.' });
    if (is_free === false && (!fee_amount || Number(fee_amount) <= 0))
      return res.status(400).json({ message: 'Fee amount must be greater than 0 for paid events.' });

    // Get coordinator's club — accept clubId from body or fall back to first assignment
    const requestedClubId = req.body.clubId || null;
    let club;
    if (requestedClubId) {
      // Verify coordinator owns this club (with name-based fallback)
      const ok = await assertCoordOwnsClub(req.user.id, requestedClubId);
      if (!ok) return res.status(403).json({ message: 'No club assigned or club inactive.' });
      const { rows: clubRow } = await pgPool.query(
        `SELECT id, name FROM clubs WHERE id = $1 AND is_active = true`, [requestedClubId]
      );
      if (!clubRow.length) return res.status(404).json({ message: 'Club not found.' });
      club = clubRow[0];
    } else {
      // No specific club requested: get all clubs this coordinator manages
      const coordClubIds = await getCoordClubIds(req.user.id);
      if (!coordClubIds.length)
        return res.status(403).json({ message: 'No club assigned to your account.' });
      const { rows: clubRow } = await pgPool.query(
        `SELECT id, name FROM clubs WHERE id = $1 AND is_active = true`, [coordClubIds[0]]
      );
      if (!clubRow.length) return res.status(403).json({ message: 'Assigned club is inactive.' });
      club = clubRow[0];
    }
    const parsedTags = Array.isArray(tags)
      ? tags
      : typeof tags === 'string'
        ? tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];

    const { rows } = await pgPool.query(
      `INSERT INTO event_requests
         (club_id, club_name, coordinator_id, coordinator_name,
          title, description, category, date, start_date, time, venue,
          seats, tags, highlight, registration_url, is_free, fee_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        club.id, club.name, req.user.id, req.user.name || '',
        title.trim(), description.trim(),
        category || 'general',
        date || '',
        start_date || null,
        time || '',
        venue.trim(),
        seats || '',
        parsedTags,
        highlight || '',
        registration_url || '',
        is_free !== false,
        is_free !== false ? 0 : Number(fee_amount) || 0,
      ]
    );
    res.status(201).json({ request: asRequest(rows[0]) });
  } catch (err) { next(err); }
};

/* ── GET /api/event-requests  (admin — all requests, optional ?status=pending) ── */
const getRequests = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { status } = req.query;
    const args  = [];
    let   where = '';
    if (status && ['pending','approved','rejected'].includes(status)) {
      args.push(status);
      where = `WHERE er.status = $1`;
    }
    const { rows } = await pgPool.query(
      `SELECT er.*, u.name AS coordinator_name
       FROM event_requests er
       JOIN users u ON u.id = er.coordinator_id
       ${where}
       ORDER BY
         CASE er.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
         er.created_at DESC`,
      args
    );
    res.json({ requests: rows.map(asRequest) });
  } catch (err) { next(err); }
};

/* ── GET /api/event-requests/mine  (coordinator — their own requests) ── */
const getMyRequests = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT * FROM event_requests
       WHERE coordinator_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: rows.map(asRequest) });
  } catch (err) { next(err); }
};

/* ── PUT /api/event-requests/:id/approve  (admin — review form + create event) ── */
const approveRequest = async (req, res, next) => {
  try {
    // 1. Load the request
    const reqRow = await pgPool.query(
      `SELECT * FROM event_requests WHERE id = $1`, [req.params.id]
    );
    if (!reqRow.rows.length)
      return res.status(404).json({ message: 'Request not found.' });
    if (reqRow.rows[0].status !== 'pending')
      return res.status(409).json({ message: 'This request has already been reviewed.' });

    // 2. Build the event from admin-submitted form (falls back to request data)
    const r = reqRow.rows[0];
    const {
      title       = r.title,
      description = r.description,
      clubId,               // admin may override club assignment
      category    = r.category,
      date        = r.date,
      start_date  = r.start_date,
      time        = r.time,
      venue       = r.venue,
      seats       = r.seats,
      tags,
      highlight   = r.highlight,
      registration_url = r.registration_url,
      is_free     = r.is_free,
      fee_amount  = r.fee_amount,
      status      = 'upcoming',
    } = req.body;

    // Resolve club: admin-supplied clubId overrides coordinator's original club
    let resolvedClubId   = r.club_id;
    let resolvedClubName = r.club_name;
    if (clubId !== undefined) {
      if (clubId) {
        const { rows: clubRows } = await pgPool.query(
          'SELECT id, name FROM clubs WHERE id = $1 AND is_active = true', [clubId]
        );
        if (clubRows[0]) { resolvedClubId = clubRows[0].id; resolvedClubName = clubRows[0].name; }
      } else {
        resolvedClubId = null; resolvedClubName = '';
      }
    }

    const parsedTags = Array.isArray(tags)
      ? tags
      : typeof tags === 'string'
        ? tags.split(',').map(t => t.trim()).filter(Boolean)
        : (r.tags || []);

    // 3. Create the event (including club_id FK)
    const evRes = await pgPool.query(
      `INSERT INTO events
         (title, club, club_id, category, status, date, start_date, time, venue,
          description, seats, tags, highlight, registration_url,
          is_free, fee_amount, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
       RETURNING *`,
      [
        title?.trim() || r.title,
        resolvedClubName,
        resolvedClubId,
        category || r.category,
        status,
        date || r.date || '',
        start_date || r.start_date || null,
        time || r.time || '',
        venue?.trim() || r.venue,
        description?.trim() || r.description,
        seats || r.seats || '',
        parsedTags,
        highlight || r.highlight || '',
        registration_url || r.registration_url || '',
        is_free !== false && is_free !== 'false',
        Number(fee_amount) || 0,
      ]
    );

    // 4. Mark request approved
    await pgPool.query(
      `UPDATE event_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, req.params.id]
    );

    res.json({ message: 'Request approved. Event created.', event: evRes.rows[0] });
  } catch (err) { next(err); }
};

/* ── PUT /api/event-requests/:id/reject  (admin — with optional note) ── */
const rejectRequest = async (req, res, next) => {
  try {
    const { admin_note = '' } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE event_requests
       SET status = 'rejected', admin_note = $1,
           reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [admin_note.trim(), req.user.id, req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ message: 'Request not found or already reviewed.' });
    res.json({ request: asRequest(rows[0]) });
  } catch (err) { next(err); }
};

/* ── Row mapper ── */
const asRequest = (r) => ({
  id:               String(r.id),
  clubId:           String(r.club_id),
  clubName:         r.club_name,
  coordinatorId:    r.coordinator_id,
  coordinatorName:  r.coordinator_name,
  title:            r.title,
  description:      r.description,
  category:         r.category,
  date:             r.date,
  startDate:        r.start_date,
  time:             r.time,
  venue:            r.venue,
  seats:            r.seats,
  tags:             r.tags || [],
  highlight:        r.highlight,
  registrationUrl:  r.registration_url,
  isFree:           r.is_free,
  feeAmount:        Number(r.fee_amount || 0),
  status:           r.status,
  adminNote:        r.admin_note,
  reviewedBy:       r.reviewed_by,
  reviewedAt:       r.reviewed_at,
  createdAt:        r.created_at,
  updatedAt:        r.updated_at,
});

module.exports = { createRequest, getRequests, getMyRequests, approveRequest, rejectRequest };
