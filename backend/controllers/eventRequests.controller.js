const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds, assertCoordOwnsClub } = require('../services/coordAuth');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const { getFileValue } = require('../config/multer');
const { destroyImage } = require('../config/cloudinary');

/* Same shape as events.controller.js's imageUrl() — Cloudinary URLs and disk-mode
   `/uploads/...` paths (as returned by getFileValue) pass through unchanged;
   anything else is a bare seeded/static asset served from the frontend's /images. */
const imageUrl = (filename) => {
  if (!filename) return '';
  if (filename.startsWith('http') || filename.startsWith('/')) return filename;
  return `/images/${filename}`;
};

/* Request bodies arrive as multipart/form-data (multer), where every non-file
   field is a string — so booleans must be parsed, never compared with === true/false. */
const parseBoolDefaultTrue  = (v) => v !== false && v !== 'false';
const parseBoolDefaultFalse = (v) => v === true || v === 'true';

/* ── POST /api/event-requests  (coordinator submits proposal) ── */
const createRequest = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const {
      title, description, category, date, start_date,
      time, venue, seats, tags, highlight, registration_url,
      is_free, fee_amount,
      objective, expected_outcome, is_special_day, special_day_name,
      target_audience, university_expectations,
    } = req.body;

    const isFree = parseBoolDefaultTrue(is_free);

    if (!title?.trim())       return res.status(400).json({ message: 'Event title is required.' });
    if (!description?.trim()) return res.status(400).json({ message: 'Description is required.' });
    if (!venue?.trim())       return res.status(400).json({ message: 'Venue is required.' });
    if (!start_date)          return res.status(400).json({ message: 'Event date is required.' });
    if (!isFree && (!fee_amount || Number(fee_amount) <= 0))
      return res.status(400).json({ message: 'Fee amount must be greater than 0 for paid events.' });
    if (!objective?.trim())               return res.status(400).json({ message: 'Objective of the event is required.' });
    if (!expected_outcome?.trim())        return res.status(400).json({ message: 'Expected outcome of the event is required.' });
    if (!target_audience?.trim())         return res.status(400).json({ message: 'Expected audience (who can participate) is required.' });
    if (!university_expectations?.trim()) return res.status(400).json({ message: 'Please mention your expectations from the university side.' });
    const specialDay = parseBoolDefaultFalse(is_special_day);
    if (specialDay && !special_day_name?.trim())
      return res.status(400).json({ message: 'Please mention which special day this event relates to.' });

    const image = getFileValue(req.file) || '';

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
          seats, tags, highlight, registration_url, is_free, fee_amount,
          objective, expected_outcome, is_special_day, special_day_name,
          target_audience, university_expectations, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
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
        isFree,
        isFree ? 0 : Number(fee_amount) || 0,
        objective.trim(),
        expected_outcome.trim(),
        specialDay,
        specialDay ? special_day_name.trim() : '',
        target_audience.trim(),
        university_expectations.trim(),
        image,
      ]
    );
    res.status(201).json({ request: asRequest(rows[0]) });

    /* Notify every admin of the new pending proposal — fire-and-forget. */
    pgPool.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true`)
      .then(({ rows: admins }) => {
        if (!admins.length) return;
        notifyManyUsers({
          userIds: admins.map(a => a.id),
          clubId:  club.id,
          title:   'New event request',
          body:    `${req.user.name || club.name} proposed "${title.trim()}".`,
          type:    'event_request',
          url:     '/admin/events',
        });
      }).catch(() => {});
  } catch (err) { next(err); }
};

/* ── PUT /api/event-requests/:id  (coordinator — edit their own pending request) ──
   Only the coordinator who submitted it can edit it, and only while it's still
   pending review — once admin has approved or rejected it, changes go through
   admin instead. */
const updateRequest = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows: existingRows } = await pgPool.query(
      `SELECT * FROM event_requests WHERE id = $1`, [req.params.id]
    );
    if (!existingRows.length) return res.status(404).json({ message: 'Request not found.' });
    const existing = existingRows[0];
    if (existing.coordinator_id !== req.user.id)
      return res.status(403).json({ message: 'You do not own this request.' });
    if (existing.status !== 'pending')
      return res.status(409).json({ message: 'Only a request that is still pending review can be edited.' });

    const {
      title, description, category, date, start_date,
      time, venue, seats, tags, highlight, registration_url,
      is_free, fee_amount,
      objective, expected_outcome, is_special_day, special_day_name,
      target_audience, university_expectations,
    } = req.body;

    const isFree = parseBoolDefaultTrue(is_free);

    if (!title?.trim())       return res.status(400).json({ message: 'Event title is required.' });
    if (!description?.trim()) return res.status(400).json({ message: 'Description is required.' });
    if (!venue?.trim())       return res.status(400).json({ message: 'Venue is required.' });
    if (!start_date)          return res.status(400).json({ message: 'Event date is required.' });
    if (!isFree && (!fee_amount || Number(fee_amount) <= 0))
      return res.status(400).json({ message: 'Fee amount must be greater than 0 for paid events.' });
    if (!objective?.trim())               return res.status(400).json({ message: 'Objective of the event is required.' });
    if (!expected_outcome?.trim())        return res.status(400).json({ message: 'Expected outcome of the event is required.' });
    if (!target_audience?.trim())         return res.status(400).json({ message: 'Expected audience (who can participate) is required.' });
    if (!university_expectations?.trim()) return res.status(400).json({ message: 'Please mention your expectations from the university side.' });
    const specialDay = parseBoolDefaultFalse(is_special_day);
    if (specialDay && !special_day_name?.trim())
      return res.status(400).json({ message: 'Please mention which special day this event relates to.' });

    const parsedTags = Array.isArray(tags)
      ? tags
      : typeof tags === 'string'
        ? tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];

    // A newly uploaded file replaces the existing banner; otherwise keep it as-is.
    const image = req.file ? getFileValue(req.file) || '' : existing.image;
    if (req.file && existing.image) destroyImage(existing.image).catch(() => {});

    const { rows } = await pgPool.query(
      `UPDATE event_requests SET
         title = $1, description = $2, category = $3, date = $4, start_date = $5,
         time = $6, venue = $7, seats = $8, tags = $9, highlight = $10,
         registration_url = $11, is_free = $12, fee_amount = $13,
         objective = $14, expected_outcome = $15, is_special_day = $16,
         special_day_name = $17, target_audience = $18, university_expectations = $19,
         image = $20, updated_at = NOW()
       WHERE id = $21
       RETURNING *`,
      [
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
        isFree,
        isFree ? 0 : Number(fee_amount) || 0,
        objective.trim(),
        expected_outcome.trim(),
        specialDay,
        specialDay ? special_day_name.trim() : '',
        target_audience.trim(),
        university_expectations.trim(),
        image,
        req.params.id,
      ]
    );
    res.json({ request: asRequest(rows[0]) });
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

    // Admin may attach a new banner while reviewing; otherwise the coordinator's
    // own submitted image (if any) carries over to the live event.
    const image = req.file ? (getFileValue(req.file) || '') : (r.image || '');

    // 3. Create the event (including club_id FK). The proposal-detail fields
    // (objective, expected outcome, special day, audience, university asks)
    // are the coordinator's own answers and always carry over as-is — admin
    // review edits the event's operational details, not the coordinator's plan.
    const evRes = await pgPool.query(
      `INSERT INTO events
         (title, club, club_id, category, status, date, start_date, time, venue,
          description, seats, tags, highlight, registration_url,
          is_free, fee_amount, is_active, image,
          objective, expected_outcome, is_special_day, special_day_name,
          target_audience, university_expectations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,$18,$19,$20,$21,$22,$23)
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
        image,
        r.objective,
        r.expected_outcome,
        r.is_special_day,
        r.special_day_name,
        r.target_audience,
        r.university_expectations,
      ]
    );

    // 4. Mark request approved
    await pgPool.query(
      `UPDATE event_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, req.params.id]
    );

    res.json({
      message: 'Request approved. Event created.',
      event: { ...evRes.rows[0], _id: String(evRes.rows[0].id), imageUrl: imageUrl(evRes.rows[0].image) },
    });

    notifyUser({
      userId: r.coordinator_id,
      clubId: resolvedClubId,
      title:  'Event request approved',
      body:   `"${evRes.rows[0].title}" was approved and is now live.`,
      type:   'event_request',
      url:    '/coordinator/events',
    }).catch(() => {});

    /* This path creates the event via a direct INSERT rather than calling
       events.controller.js's create(), so it needs its own copy of the
       "new event posted" student fan-out — otherwise events approved this
       way silently never notify anyone but the coordinator who proposed it. */
    const newEvent = evRes.rows[0];
    const studentNotifTitle = 'New event posted';
    const studentNotifBody  = `${resolvedClubName || 'SOAC'} posted a new event: "${newEvent.title}".`;
    const studentNotifUrl   = `/student/events/${newEvent.id}`;
    if (resolvedClubId) {
      pgPool.query(
        `SELECT u.id FROM student_clubs sc
         JOIN users u ON u.id = sc.user_id AND u.is_active = true
         WHERE sc.club_id = $1::bigint AND sc.is_active = true`,
        [resolvedClubId]
      ).then(({ rows: members }) => {
        if (!members.length) return;
        notifyManyUsers({
          userIds: members.map(m => m.id),
          clubId:  resolvedClubId,
          title:   studentNotifTitle,
          body:    studentNotifBody,
          type:    'event',
          url:     studentNotifUrl,
        });
      }).catch(() => {});
    } else {
      pgPool.query(`SELECT id FROM users WHERE role = 'student' AND is_active = true`)
        .then(({ rows: students }) => {
          if (!students.length) return;
          notifyManyUsers({
            userIds: students.map(s => s.id),
            title:   studentNotifTitle,
            body:    studentNotifBody,
            type:    'event',
            url:     studentNotifUrl,
          });
        }).catch(() => {});
    }
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

    notifyUser({
      userId: rows[0].coordinator_id,
      clubId: rows[0].club_id,
      title:  'Event request rejected',
      body:   admin_note.trim()
        ? `"${rows[0].title}" was rejected: ${admin_note.trim()}`
        : `"${rows[0].title}" was rejected.`,
      type:   'event_request',
      url:    '/coordinator/events',
    }).catch(() => {});
  } catch (err) { next(err); }
};

/* ── DELETE /api/event-requests/:id  (coordinator — their own, once reviewed) ──
   A pending request is still awaiting admin action, so it stays undeletable —
   only once admin has approved or rejected it (nothing left to review) can the
   coordinator clear it from their list. Admins may delete any reviewed request. */
const deleteRequest = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(`SELECT * FROM event_requests WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Request not found.' });
    const r = rows[0];

    if (req.user.role !== 'admin' && r.coordinator_id !== req.user.id) {
      return res.status(403).json({ message: 'You do not own this request.' });
    }
    if (r.status === 'pending') {
      return res.status(409).json({ message: 'This request is still pending review and cannot be deleted yet.' });
    }

    await pgPool.query(`DELETE FROM event_requests WHERE id = $1`, [req.params.id]);
    // Only clean up the banner for a rejected request — an approved request's
    // image may be the very same Cloudinary asset the live event now uses.
    if (r.status === 'rejected' && r.image) destroyImage(r.image).catch(() => {});
    res.json({ message: 'Request deleted.' });
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
  image:            r.image || '',
  imageUrl:         imageUrl(r.image),
  objective:        r.objective,
  expectedOutcome:  r.expected_outcome,
  isSpecialDay:     r.is_special_day,
  specialDayName:   r.special_day_name,
  targetAudience:   r.target_audience,
  universityExpectations: r.university_expectations,
  status:           r.status,
  adminNote:        r.admin_note,
  reviewedBy:       r.reviewed_by,
  reviewedAt:       r.reviewed_at,
  createdAt:        r.created_at,
  updatedAt:        r.updated_at,
});

module.exports = { createRequest, updateRequest, getRequests, getMyRequests, approveRequest, rejectRequest, deleteRequest };
