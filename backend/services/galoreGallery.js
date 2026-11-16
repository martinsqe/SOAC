/* Galore — Gallery. Photos and videos of the Galore event, posted by the admin
   or the main Galore coordinator and shown to everyone in the Galore portal the
   same way the Club Feed shows a club's posts (bento grid + lightbox).
   Students only view — they can't add to it.

   Uploads work like the Club Feed: the browser shrinks a photo and sends it
   straight to Cloudinary with a short-lived signature (only into the
   galore-gallery folder), then saves the URL here; without Cloudinary the file
   is posted to the server instead. */
const { pgPool } = require('../config/db');
const { cloudinary, destroyMedia } = require('../config/cloudinary');
const { uploadMediaBuffer } = require('../config/multer');

const FOLDER = 'galore-gallery';

const ready = (async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS galore_gallery (
      id             BIGSERIAL     PRIMARY KEY,
      event_id       BIGINT        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      media_type     VARCHAR(10)   NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
      media_url      VARCHAR(500)  NOT NULL,
      thumbnail_url  VARCHAR(500)  NOT NULL DEFAULT '',
      media_width    INTEGER       NOT NULL DEFAULT 0,
      media_height   INTEGER       NOT NULL DEFAULT 0,
      caption        VARCHAR(300)  NOT NULL DEFAULT '',
      posted_by      VARCHAR(255)  NOT NULL DEFAULT '',
      posted_role    VARCHAR(20)   NOT NULL DEFAULT 'admin',
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_galore_gallery_event ON galore_gallery(event_id, created_at DESC)`);
})().catch(err => console.error('[galoreGallery] migration failed:', err.message));

class GalleryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const postOut = (r) => ({
  id: String(r.id), mediaType: r.media_type, mediaUrl: r.media_url, thumbnailUrl: r.thumbnail_url,
  mediaWidth: r.media_width, mediaHeight: r.media_height, caption: r.caption,
  postedBy: r.posted_by, postedRole: r.posted_role, createdAt: r.created_at,
});

async function list(eventId) {
  await ready;
  const { rows } = await pgPool.query(
    'SELECT * FROM galore_gallery WHERE event_id = $1 ORDER BY created_at DESC, id DESC',
    [eventId]
  );
  return rows.map(postOut);
}

/* { direct: false } when Cloudinary isn't configured — the client then posts the file */
function signature(kind) {
  if (!cloudinary) return { direct: false };
  const isVideo = kind === 'video';
  const params = {
    folder: FOLDER,
    timestamp: Math.round(Date.now() / 1000),
    allowed_formats: isVideo ? 'mp4,mov,webm' : 'jpg,jpeg,png,webp,gif',
  };
  return {
    direct: true,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    resourceType: isVideo ? 'video' : 'image',
    ...params,
    signature: cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET),
  };
}

/* A URL the browser uploaded must be one of OUR gallery assets of that type */
const isOwnAsset = (url, mediaType) => {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud || typeof url !== 'string') return false;
  const re = new RegExp(`^https://res\\.cloudinary\\.com/${cloud.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${mediaType}/upload/(v\\d+/)?${FOLDER}/[^?#\\s]+$`);
  return re.test(url);
};

/* body: { caption, mediaUrl, mediaType, width, height } (direct upload) or a
   multer file (fallback). by: { name, role: 'admin' | 'head' } */
async function create(eventId, body = {}, file = null, by = {}) {
  await ready;
  const caption = String(body.caption || '').trim();
  if (caption.length > 300) throw new GalleryError('Caption must be 300 characters or fewer.');
  let media;
  if (!file && body.mediaUrl) {
    const mediaType = body.mediaType === 'video' ? 'video' : 'image';
    if (!isOwnAsset(body.mediaUrl, mediaType)) throw new GalleryError('That upload could not be verified. Please try again.');
    media = {
      url: body.mediaUrl, mediaType,
      width: Math.max(0, parseInt(body.width, 10) || 0),
      height: Math.max(0, parseInt(body.height, 10) || 0),
      thumbnailUrl: mediaType === 'video' ? body.mediaUrl.replace(/\.\w+($|\?)/, '.jpg$1') : '',
    };
  } else if (file) {
    media = await uploadMediaBuffer(file, FOLDER);
  } else {
    throw new GalleryError('Choose a photo or video to add.');
  }
  const { rows: [r] } = await pgPool.query(
    `INSERT INTO galore_gallery (event_id, media_type, media_url, thumbnail_url, media_width, media_height, caption, posted_by, posted_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [eventId, media.mediaType, media.url, media.thumbnailUrl || '', media.width || 0, media.height || 0, caption,
     String(by.name || '').slice(0, 255), by.role === 'head' ? 'head' : 'admin']
  );
  return postOut(r);
}

async function remove(eventId, postId) {
  await ready;
  const { rows: [r] } = await pgPool.query(
    'DELETE FROM galore_gallery WHERE id = $1 AND event_id = $2 RETURNING media_url, media_type',
    [postId, eventId]
  );
  if (!r) throw new GalleryError('That photo is already gone.', 404);
  destroyMedia(r.media_url, r.media_type).catch(() => {});
}

module.exports = { ready, GalleryError, list, signature, create, remove };
