const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds, getClubCoordinatorIds, assertCoordOwnsClub } = require('../services/coordAuth');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const { uploadMediaBuffer } = require('../config/multer');
const { destroyMedia } = require('../config/cloudinary');

/* ── POST /api/club-feed  (submit a photo/video)
   A student's submission goes to 'pending' and notifies the club's
   coordinator(s). A coordinator posting to a club they manage publishes
   immediately — they're the approver, so there's nothing to review. ── */
const createPost = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId, caption = '' } = req.body;
    const isCoordinator = req.user.role === 'coordinator';

    if (!req.file) return res.status(400).json({ message: 'Please choose a photo or video to submit.' });
    if (!clubId)   return res.status(400).json({ message: 'Please choose which club this is for.' });
    if (caption.length > 300) return res.status(400).json({ message: 'Caption must be 300 characters or fewer.' });

    let club;
    if (isCoordinator) {
      const owns = await assertCoordOwnsClub(req.user.id, clubId);
      if (!owns) return res.status(403).json({ message: 'You do not manage this club.' });
      const { rows } = await pgPool.query(`SELECT id AS club_id, name AS club_name FROM clubs WHERE id = $1`, [clubId]);
      if (!rows.length) return res.status(404).json({ message: 'Club not found.' });
      club = rows[0];
    } else {
      const { rows: membership } = await pgPool.query(
        `SELECT sc.club_id, c.name AS club_name
         FROM student_clubs sc
         JOIN clubs c ON c.id = sc.club_id
         WHERE sc.user_id = $1 AND sc.club_id = $2 AND sc.is_active = true`,
        [req.user.id, clubId]
      );
      if (!membership.length)
        return res.status(403).json({ message: 'You can only submit to a club you are an active member of.' });
      club = membership[0];
    }

    const media = await uploadMediaBuffer(req.file, 'club-feed');

    const { rows } = await pgPool.query(
      `INSERT INTO club_feed_posts
         (club_id, club_name, student_id, student_name, media_type, media_url,
          thumbnail_url, media_width, media_height, caption,
          status, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        club.club_id, club.club_name, req.user.id, req.user.name || '',
        media.mediaType, media.url, media.thumbnailUrl, media.width, media.height,
        caption.trim(),
        isCoordinator ? 'approved' : 'pending',
        isCoordinator ? req.user.id : null,
        isCoordinator ? new Date() : null,
      ]
    );
    res.status(201).json({ post: asPost(rows[0]) });

    if (!isCoordinator) {
      getClubCoordinatorIds(club.club_id).then((coordIds) => {
        if (!coordIds.length) return;
        notifyManyUsers({
          userIds: coordIds,
          clubId:  club.club_id,
          title:   'New club feed submission',
          body:    `${req.user.name || 'A member'} submitted a ${media.mediaType} to ${club.club_name}'s feed.`,
          type:    'club_feed_submission',
          url:     '/coordinator/club-feed',
        });
      }).catch(() => {});
    }
  } catch (err) { next(err); }
};

/* ── GET /api/club-feed  (student — approved posts from their own clubs)
   ?clubId= scopes the feed to just that one club — a student in several
   clubs must see each club's feed separately when they switch between them,
   never merged. Without ?clubId=, falls back to every club they're in
   (kept for any caller that genuinely wants the combined view). ── */
const getFeed = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId } = req.query;
    const limit  = Math.min(Number(req.query.limit) || 30, 60);
    const offset = Number(req.query.offset) || 0;

    let rows;
    if (clubId) {
      const { rows: membership } = await pgPool.query(
        `SELECT 1 FROM student_clubs WHERE user_id = $1 AND club_id = $2 AND is_active = true`,
        [req.user.id, clubId]
      );
      if (!membership.length) return res.status(403).json({ message: 'You are not a member of this club.' });

      ({ rows } = await pgPool.query(
        `SELECT * FROM club_feed_posts
         WHERE status = 'approved' AND club_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [clubId, limit, offset]
      ));
    } else {
      ({ rows } = await pgPool.query(
        `SELECT * FROM club_feed_posts
         WHERE status = 'approved'
           AND club_id IN (SELECT club_id FROM student_clubs WHERE user_id = $1 AND is_active = true)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ));
    }
    res.json({ posts: rows.map(asPost) });
  } catch (err) { next(err); }
};

/* ── GET /api/club-feed/mine  (student — their own submissions, any status) ── */
const getMyPosts = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT * FROM club_feed_posts WHERE student_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ posts: rows.map(asPost) });
  } catch (err) { next(err); }
};

/* ── GET /api/club-feed/review  (coordinator — queue for clubs they manage)
   ?clubId= scopes the queue to just that one club — a coordinator managing
   several clubs must see each club's feed separately, never merged, exactly
   like every other coordinator page (Events, Members, ...) already scopes to
   whichever club is currently selected. Without ?clubId=, falls back to every
   club they manage (kept for callers that genuinely want the union, e.g. the
   sidebar's pending-count badge). ── */
const getReviewQueue = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { status, clubId } = req.query;

    let scopedClubIds;
    if (clubId) {
      const owns = await assertCoordOwnsClub(req.user.id, clubId);
      if (!owns) return res.status(403).json({ message: 'You do not manage this club.' });
      scopedClubIds = [Number(clubId)];
    } else {
      scopedClubIds = (await getCoordClubIds(req.user.id)).map(Number);
    }
    if (!scopedClubIds.length) return res.json({ posts: [] });

    const args  = [scopedClubIds];
    let   where = 'club_id = ANY($1::bigint[])';
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      args.push(status);
      where += ` AND status = $${args.length}`;
    }
    const { rows } = await pgPool.query(
      `SELECT * FROM club_feed_posts
       WHERE ${where}
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
         created_at DESC`,
      args
    );
    res.json({ posts: rows.map(asPost) });
  } catch (err) { next(err); }
};

/* ── PUT /api/club-feed/:id/approve  (coordinator) ── */
const approvePost = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(`SELECT * FROM club_feed_posts WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Post not found.' });
    const post = rows[0];

    const owns = await assertCoordOwnsClub(req.user.id, post.club_id);
    if (!owns) return res.status(403).json({ message: 'You do not manage this club.' });
    if (post.status !== 'pending')
      return res.status(409).json({ message: 'This submission has already been reviewed.' });

    const { rows: updated } = await pgPool.query(
      `UPDATE club_feed_posts
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json({ post: asPost(updated[0]) });

    notifyUser({
      userId: post.student_id,
      clubId: post.club_id,
      title:  'Your club feed post was approved',
      body:   `Your ${post.media_type} for ${post.club_name} is now live in the Clubs Feed.`,
      type:   'club_feed_submission',
      url:    '/student/clubs-feed',
    }).catch(() => {});
  } catch (err) { next(err); }
};

/* ── PUT /api/club-feed/:id/reject  (coordinator, with optional note) ── */
const rejectPost = async (req, res, next) => {
  try {
    const { admin_note = '' } = req.body;
    const { rows } = await pgPool.query(`SELECT * FROM club_feed_posts WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Post not found.' });
    const post = rows[0];

    const owns = await assertCoordOwnsClub(req.user.id, post.club_id);
    if (!owns) return res.status(403).json({ message: 'You do not manage this club.' });
    if (post.status !== 'pending')
      return res.status(409).json({ message: 'This submission has already been reviewed.' });

    const { rows: updated } = await pgPool.query(
      `UPDATE club_feed_posts
       SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [admin_note.trim(), req.user.id, req.params.id]
    );
    res.json({ post: asPost(updated[0]) });

    notifyUser({
      userId: post.student_id,
      clubId: post.club_id,
      title:  'Your club feed post was not approved',
      body:   admin_note.trim()
        ? `Your submission to ${post.club_name} was rejected: ${admin_note.trim()}`
        : `Your submission to ${post.club_name} was rejected.`,
      type:   'club_feed_submission',
      url:    '/student/clubs-feed',
    }).catch(() => {});
  } catch (err) { next(err); }
};

/* ── DELETE /api/club-feed/:id  (owning student, any status — or a coordinator
   of that club, or admin, for moderation) ── */
const deletePost = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(`SELECT * FROM club_feed_posts WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Post not found.' });
    const post = rows[0];

    const isOwner = post.student_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isCoord = req.user.role === 'coordinator' && await assertCoordOwnsClub(req.user.id, post.club_id);
    if (!isOwner && !isAdmin && !isCoord)
      return res.status(403).json({ message: 'You cannot delete this post.' });

    await pgPool.query(`DELETE FROM club_feed_posts WHERE id = $1`, [req.params.id]);
    destroyMedia(post.media_url, post.media_type).catch(() => {});
    res.json({ message: 'Post deleted.' });
  } catch (err) { next(err); }
};

/* ── Row mapper ── */
const asPost = (r) => ({
  id:            String(r.id),
  clubId:        String(r.club_id),
  clubName:      r.club_name,
  studentId:     r.student_id,
  studentName:   r.student_name,
  mediaType:     r.media_type,
  mediaUrl:      r.media_url,
  thumbnailUrl:  r.thumbnail_url,
  mediaWidth:    r.media_width,
  mediaHeight:   r.media_height,
  caption:       r.caption,
  status:        r.status,
  adminNote:     r.admin_note,
  reviewedBy:    r.reviewed_by,
  reviewedAt:    r.reviewed_at,
  createdAt:     r.created_at,
  updatedAt:     r.updated_at,
});

module.exports = { createPost, getFeed, getMyPosts, getReviewQueue, approvePost, rejectPost, deletePost };
