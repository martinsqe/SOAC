const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds, getClubCoordinatorIds, assertCoordOwnsClub } = require('../services/coordAuth');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const { uploadMediaBuffer } = require('../config/multer');
const { cloudinary, destroyMedia } = require('../config/cloudinary');
const { sendClubFeedUpdate, sendClubFeedPostLive, sendClubFeedReviewRequest } = require('../config/email');
const { emailEach } = require('../services/mailRecipients');

const FEED_FOLDER = 'club-feed';

/* A post just went live (a coordinator added it, or approved a member's
   submission). Every other active member of the club is emailed and notified
   that something new is in the feed — never who posted it — with an invite to
   add their own. If a member submitted it, they get their own "your post is
   live" email. Runs in the background after the response; emails go through
   the shared send queue. */
const announceFeedPost = async (post) => {
  const { rows: poster } = await pgPool.query(
    `SELECT id, name, email, role FROM users WHERE id = $1`, [post.student_id]
  );
  const posterEmail = (poster[0]?.email || '').toLowerCase();

  const { rows: members } = await pgPool.query(
    `SELECT DISTINCT ON (u.id) u.id, u.name, u.email
     FROM student_clubs sc
     JOIN users u ON u.id = sc.user_id AND u.is_active = true AND u.role = 'student'
     WHERE sc.club_id = $1 AND sc.is_active = true
       AND LOWER(u.email) <> $2`,
    [post.club_id, posterEmail]
  );

  if (members.length) {
    notifyManyUsers({
      userIds: members.map(m => m.id),
      clubId:  post.club_id,
      title:   `New in the ${post.club_name} Club Feed`,
      body:    `A new ${post.media_type === 'video' ? 'video' : 'photo'} was added — check it out, and share yours too!`,
      type:    'club_feed_post',
      url:     '/student/clubs-feed',
    }).catch(() => {});
    for (const m of members) {
      sendClubFeedUpdate({ toEmail: m.email, toName: m.name, clubName: post.club_name, mediaType: post.media_type })
        .catch(err => console.error(`[clubFeed] update email failed for ${m.email}:`, err.message));
    }
  }

  if (poster[0]?.role === 'student') {
    sendClubFeedPostLive({ toEmail: poster[0].email, toName: poster[0].name, clubName: post.club_name, mediaType: post.media_type })
      .catch(err => console.error(`[clubFeed] post-live email failed for ${poster[0].email}:`, err.message));
  }
};
const isCoordRole = (role) => role === 'coordinator' || role === 'faculty_coordinator';

/* The club this user may post to: a coordinator's own club, or a club the
   student is an active member of. Returns { club } or { status, message }. */
const resolvePostClub = async (user, clubId) => {
  if (!clubId) return { status: 400, message: 'Please choose which club this is for.' };
  if (isCoordRole(user.role)) {
    if (!(await assertCoordOwnsClub(user.id, clubId))) return { status: 403, message: 'You do not manage this club.' };
    const { rows } = await pgPool.query(`SELECT id AS club_id, name AS club_name FROM clubs WHERE id = $1`, [clubId]);
    if (!rows.length) return { status: 404, message: 'Club not found.' };
    return { club: rows[0] };
  }
  const { rows } = await pgPool.query(
    `SELECT sc.club_id, c.name AS club_name
     FROM student_clubs sc
     JOIN clubs c ON c.id = sc.club_id
     WHERE sc.user_id = $1 AND sc.club_id = $2 AND sc.is_active = true`,
    [user.id, clubId]
  );
  if (!rows.length) return { status: 403, message: 'You can only submit to a club you are an active member of.' };
  return { club: rows[0] };
};

/* ── POST /api/club-feed/upload-signature  body: { clubId, kind: 'image'|'video' }
   Fast path: the browser uploads the photo/video STRAIGHT to Cloudinary with
   this short-lived signature (only into the club-feed folder, only allowed
   formats), then sends the resulting URL to POST /api/club-feed. The file never
   passes through this server — one upload instead of two, no 50 MB buffering,
   and the browser can show real upload progress. { direct: false } when
   Cloudinary isn't configured; the client then posts the file the old way. ── */
const uploadSignature = async (req, res, next) => {
  try {
    const found = await resolvePostClub(req.user, req.body?.clubId);
    if (found.status) return res.status(found.status).json({ message: found.message });
    if (!cloudinary) return res.json({ direct: false });

    const isVideo = req.body?.kind === 'video';
    const params = {
      folder: FEED_FOLDER,
      timestamp: Math.round(Date.now() / 1000),
      allowed_formats: isVideo ? 'mp4,mov,webm' : 'jpg,jpeg,png,webp,gif',
    };
    res.json({
      direct:       true,
      cloudName:    process.env.CLOUDINARY_CLOUD_NAME,
      apiKey:       process.env.CLOUDINARY_API_KEY,
      resourceType: isVideo ? 'video' : 'image',
      ...params,
      signature:    cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET),
    });
  } catch (err) { next(err); }
};

/* A media URL uploaded directly by the browser must be one of OUR club-feed
   assets of the stated type: https://res.cloudinary.com/<cloud>/<type>/upload/[v123/]club-feed/... */
const isOwnFeedAsset = (url, mediaType) => {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud || typeof url !== 'string') return false;
  const re = new RegExp(`^https://res\\.cloudinary\\.com/${cloud.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${mediaType}/upload/(v\\d+/)?${FEED_FOLDER}/[^?#\\s]+$`);
  return re.test(url);
};

/* ── POST /api/club-feed  (submit a photo/video)
   Either JSON { clubId, caption, mediaUrl, mediaType, width, height } for media
   the browser already uploaded to Cloudinary (fast path), or multipart with the
   file in 'media' (fallback). A student's submission goes to 'pending' and
   notifies the club's coordinator(s). A coordinator posting to a club they
   manage publishes immediately — they're the approver, so there's nothing to review. ── */
const createPost = async (req, res, next) => {
  try {
    const { clubId, caption = '' } = req.body;
    const isCoordinator = isCoordRole(req.user.role);
    const direct = !req.file && req.body.mediaUrl;

    if (!req.file && !direct) return res.status(400).json({ message: 'Please choose a photo or video to submit.' });
    if (caption.length > 300) return res.status(400).json({ message: 'Caption must be 300 characters or fewer.' });

    const found = await resolvePostClub(req.user, clubId);
    if (found.status) return res.status(found.status).json({ message: found.message });
    const { club } = found;

    let media;
    if (direct) {
      const mediaType = req.body.mediaType === 'video' ? 'video' : 'image';
      if (!isOwnFeedAsset(req.body.mediaUrl, mediaType)) {
        return res.status(400).json({ message: 'That upload could not be verified. Please try again.' });
      }
      media = {
        url: req.body.mediaUrl,
        mediaType,
        width:  Math.max(0, parseInt(req.body.width, 10) || 0),
        height: Math.max(0, parseInt(req.body.height, 10) || 0),
        /* Cloudinary serves a video's poster frame at the same path with .jpg */
        thumbnailUrl: mediaType === 'video' ? req.body.mediaUrl.replace(/\.\w+($|\?)/, '.jpg$1') : '',
      };
    } else {
      media = await uploadMediaBuffer(req.file, FEED_FOLDER);
    }

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

    /* A coordinator's post is live straight away — tell the club */
    if (isCoordinator) {
      announceFeedPost(rows[0]).catch(err => console.error('[clubFeed] announce failed:', err.message));
    }

    if (!isCoordinator) {
      /* The club's SC / FA get both an in-app notification and an email —
         the same people for both (one email per address) */
      getClubCoordinatorIds(club.club_id).then(async (coordIds) => {
        if (!coordIds.length) return;
        const { rows: reviewers } = await pgPool.query(
          `SELECT id, email, name FROM users
           WHERE id = ANY($1::int[]) AND is_active = true AND COALESCE(email, '') <> ''`,
          [coordIds]
        );
        emailEach(reviewers, (s) => sendClubFeedReviewRequest({
          toEmail: s.email, toName: s.name, clubName: club.club_name, clubId: club.club_id, studentName: req.user.name,
          mediaType: media.mediaType, caption: caption.trim(), mediaUrl: media.url, postId: rows[0].id,
        }), 'club feed review');
        notifyManyUsers({
          userIds: coordIds,
          clubId:  club.club_id,
          title:   'New club feed submission',
          body:    `${req.user.name || 'A member'} submitted a ${media.mediaType} to ${club.club_name}'s feed.`,
          type:    'club_feed_submission',
          url:     `/coordinator/club-feed?review=${rows[0].id}&club=${club.club_id}`,
        });
      }).catch(err => console.error('[clubFeed] review notify/email failed:', err.message));
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
    /* Members see the club's photos and videos, not who posted them */
    res.json({ posts: rows.map(asPost).map(({ studentId, studentName, ...post }) => post) });
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

    /* Now live — email the member, and tell the rest of the club (without names) */
    announceFeedPost(updated[0]).catch(err => console.error('[clubFeed] announce failed:', err.message));
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
    const isCoord = (req.user.role === 'coordinator' || req.user.role === 'faculty_coordinator') && await assertCoordOwnsClub(req.user.id, post.club_id);
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

module.exports = { uploadSignature, createPost, getFeed, getMyPosts, getReviewQueue, approvePost, rejectPost, deletePost };
