const crypto = require('crypto');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const ALLOWED_VIDEO = ['mp4', 'mov', 'webm'];

/* Cloudinary when configured, disk otherwise */
const cloudinaryInstance = require('./cloudinary').cloudinary;
const useCloudinary = !!cloudinaryInstance;

/* A stored file name nobody can guess: time + 128 random bits + a cleaned-up
   original name (kept only so downloads still have a recognisable name). */
const safeName = (originalname = 'file') => {
  const clean = String(originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `${Date.now()}-${crypto.randomBytes(16).toString('hex')}-${clean}`;
};

/* Disk fallback (same behaviour as before Cloudinary was added) */
const diskStorage = (subfolder) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, safeName(file.originalname)),
  });

/* Streams an image straight to Cloudinary — a small replacement for the
   unmaintained multer-storage-cloudinary package (which pinned the vulnerable
   Cloudinary SDK v1). Same result shape: file.path = the image URL. */
class CloudinaryImageStorage {
  constructor(folder) { this.folder = folder; }
  _handleFile(req, file, cb) {
    const upload = cloudinaryInstance.uploader.upload_stream(
      { folder: this.folder, resource_type: 'image', allowed_formats: ALLOWED },
      (err, r) => (err ? cb(err) : cb(null, { path: r.secure_url, filename: r.public_id, size: r.bytes }))
    );
    file.stream.on('error', cb);
    file.stream.pipe(upload);
  }
  _removeFile(req, file, cb) {
    if (!file.filename) return cb(null);
    cloudinaryInstance.uploader.destroy(file.filename).then(() => cb(null), () => cb(null));
  }
}

const makeStorage = (folder) => (useCloudinary ? new CloudinaryImageStorage(folder) : diskStorage(folder));

const imageFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (ALLOWED.includes(ext)) return cb(null, true);
  cb(Object.assign(new Error('Only image files (jpg, jpeg, png, webp, gif) are allowed.'), { status: 400 }));
};

/* Club Feed accepts either an image OR a video in the same field. */
const mediaFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (ALLOWED.includes(ext) || ALLOWED_VIDEO.includes(ext)) return cb(null, true);
  cb(Object.assign(new Error('Only image (jpg, jpeg, png, webp, gif) or video (mp4, mov, webm) files are allowed.'), { status: 400 }));
};

/* Certificate templates are later embedded into a PDF via pdf-lib, which only supports
   PNG/JPEG (not webp/gif) — narrower filter than the general imageFilter above. */
const CERT_ALLOWED = ['jpg', 'jpeg', 'png'];
const certImageFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (CERT_ALLOWED.includes(ext)) return cb(null, true);
  cb(Object.assign(new Error('Only JPG or PNG images are allowed for certificate templates.'), { status: 400 }));
};

/**
 * Returns the value to store in the DB for an uploaded file.
 *   Cloudinary mode → file.path  (https://res.cloudinary.com/...)
 *   Disk mode       → /uploads/<subfolder>/<filename>  (URL-accessible via the /uploads static route)
 */
const getFileValue = (file) => {
  if (!file) return null;
  if (useCloudinary) return file.path;
  // Convert absolute disk path to a URL-routable path
  const norm = file.path.replace(/\\/g, '/');
  const idx  = norm.lastIndexOf('/uploads/');
  return idx !== -1 ? norm.slice(idx) : `/uploads/${file.filename}`;
};

/* Every upload: one file per field unless the route says otherwise, and a cap on
   the number of non-file fields, so a malformed multipart body can't exhaust memory */
const LIMITS = (fileSize) => ({ fileSize, fields: 50, fieldSize: 100 * 1024, parts: 80 });

const uploadLogo       = multer({ storage: makeStorage('logos'),      fileFilter: imageFilter, limits: LIMITS(5  * 1024 * 1024) });
const uploadEvent      = multer({ storage: makeStorage('events'),     fileFilter: imageFilter, limits: LIMITS(10 * 1024 * 1024) });
const uploadFame       = multer({ storage: makeStorage('fame'),       fileFilter: imageFilter, limits: LIMITS(5  * 1024 * 1024) });
const uploadLeadership = multer({ storage: makeStorage('leadership'), fileFilter: imageFilter, limits: LIMITS(5  * 1024 * 1024) });

/* Avatar uses memoryStorage so the controller can upload the buffer to Cloudinary
   inside a proper try/catch — avoids the "socket hang up" crash from unhandled
   stream errors. */
const uploadAvatar   = multer({ storage: multer.memoryStorage(), fileFilter: imageFilter, limits: LIMITS(5 * 1024 * 1024) });

/* Same memoryStorage escape hatch as uploadAvatar, for routes that build several
   DB rows in one request (e.g. createGaloreEvent, which creates the umbrella +
   12 activities in one transaction) — a flaky/slow Cloudinary upload must never
   crash the whole request via an unhandled stream rejection. Pair with
   uploadImageBuffer() below, inside a try/catch, in the controller. */
const uploadEventMemory = multer({ storage: multer.memoryStorage(), fileFilter: imageFilter, limits: LIMITS(10 * 1024 * 1024) });

/* Write a buffer to the disk fallback under uploads/<folder>, returning its URL path */
const writeDiskUpload = (file, folder) => {
  const dir = path.join(__dirname, '..', 'uploads', folder);
  fs.mkdirSync(dir, { recursive: true });
  const fname = safeName(file.originalname);
  fs.writeFileSync(path.join(dir, fname), file.buffer);
  return `/uploads/${folder}/${fname}`;
};

/* Upload a memoryStorage file buffer to Cloudinary (or disk, if Cloudinary isn't
   configured), returning the stored value for the DB — same shape as getFileValue().
   Bounded by a timeout so a hung Cloudinary connection rejects instead of hanging
   the request indefinitely. Throws on failure — callers decide whether that should
   block the whole request or just mean "create it without an image". */
const uploadImageBuffer = async (file, folder, timeoutMs = 12000) => {
  if (useCloudinary) {
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        const stream = cloudinaryInstance.uploader.upload_stream(
          { folder, resource_type: 'image', allowed_formats: ALLOWED },
          (err, r) => (err ? reject(err) : resolve(r))
        );
        stream.end(file.buffer);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Image upload timed out')), timeoutMs)),
    ]);
    return result.secure_url;
  }
  return writeDiskUpload(file, folder);
};
const uploadMvpPhoto    = multer({ storage: makeStorage('mvp'),           fileFilter: imageFilter, limits: LIMITS(5  * 1024 * 1024) });
const uploadReportPhoto = multer({ storage: makeStorage('report-photos'), fileFilter: imageFilter, limits: LIMITS(10 * 1024 * 1024) });
const uploadExplore     = multer({ storage: makeStorage('explore'),       fileFilter: imageFilter, limits: LIMITS(10 * 1024 * 1024) });
const uploadCertTemplate = multer({ storage: makeStorage('cert-templates'), fileFilter: certImageFilter, limits: LIMITS(10 * 1024 * 1024) });

/* Club Feed submissions can be an image OR a video — the resource_type has to be
   picked per-file (image vs video), so this uses memoryStorage + a manual upload,
   with a larger cap for video. */
const uploadClubFeedMedia = multer({ storage: multer.memoryStorage(), fileFilter: mediaFilter, limits: LIMITS(50 * 1024 * 1024) });

/* Same shape as uploadImageBuffer(), but picks image vs video resource_type from
   the file extension and also returns Cloudinary's reported width/height (used to
   size each tile in the masonry grid) plus a thumbnail for videos (Cloudinary
   auto-generates a poster frame when the same asset is requested with a .jpg
   extension — swapping it is all that's needed, no extra transform/upload). */
const uploadMediaBuffer = async (file, folder, timeoutMs = 20000) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  const isVideo = ALLOWED_VIDEO.includes(ext);
  const mediaType = isVideo ? 'video' : 'image';

  if (useCloudinary) {
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        const stream = cloudinaryInstance.uploader.upload_stream(
          { folder, resource_type: mediaType, allowed_formats: isVideo ? ALLOWED_VIDEO : ALLOWED },
          (err, r) => (err ? reject(err) : resolve(r))
        );
        stream.end(file.buffer);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Media upload timed out')), timeoutMs)),
    ]);
    return {
      url: result.secure_url,
      mediaType,
      width: result.width || 0,
      height: result.height || 0,
      thumbnailUrl: isVideo ? result.secure_url.replace(/\.\w+($|\?)/, '.jpg$1') : '',
    };
  }
  // Disk fallback — no dimensions or auto-thumbnail available.
  return { url: writeDiskUpload(file, folder), mediaType, width: 0, height: 0, thumbnailUrl: '' };
};

/* Documents (Galore rules & regulations, activity proofs): PDF, Word or an
   image, kept in memory and stored with uploadDocumentBuffer / privateFiles. */
const DOC_EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp'];
const uploadDocumentMemory = multer({
  storage: multer.memoryStorage(),
  limits: LIMITS(15 * 1024 * 1024),
  fileFilter: (req, file, cb) => {
    const ok = DOC_EXT.includes(file.originalname.split('.').pop().toLowerCase());
    cb(ok ? null : Object.assign(new Error('Upload a PDF, Word document or image.'), { status: 400 }), ok);
  },
});
/* Cloudinary keeps non-image files as 'raw' resources (served as-is, file
   extension kept); disk fallback mirrors uploadImageBuffer. Returns the URL.
   For PUBLIC documents only — anything with personal data goes through
   services/privateFiles.js instead. */
const uploadDocumentBuffer = async (file, folder, timeoutMs = 30000) => {
  if (useCloudinary) {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
    const base = file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${base}`;
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        const stream = cloudinaryInstance.uploader.upload_stream(
          { folder, resource_type: isImage ? 'image' : 'raw', public_id: `${unique}${isImage ? '' : `.${ext}`}` },
          (err, r) => (err ? reject(err) : resolve(r))
        );
        stream.end(file.buffer);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out')), timeoutMs)),
    ]);
    return result.secure_url;
  }
  return writeDiskUpload(file, folder);
};

module.exports = { uploadDocumentMemory, uploadDocumentBuffer, uploadLogo, uploadEvent, uploadEventMemory, uploadAvatar, uploadFame, uploadLeadership, uploadMvpPhoto, uploadReportPhoto, uploadExplore, uploadCertTemplate, uploadClubFeedMedia, getFileValue, uploadImageBuffer, uploadMediaBuffer, cloudinaryInstance, useCloudinary, safeName, DOC_EXT };
