const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/* ── Try to load Cloudinary storage; fall back to disk if not installed ── */
let useCloudinary = false;
let CloudinaryStorage = null;
let cloudinaryInstance = null;

try {
  CloudinaryStorage  = require('multer-storage-cloudinary').CloudinaryStorage;
  cloudinaryInstance = require('./cloudinary').cloudinary;
  if (cloudinaryInstance) useCloudinary = true;
} catch (_) {
  console.warn('[multer] cloudinary/multer-storage-cloudinary not installed — using disk storage. Run: npm install cloudinary multer-storage-cloudinary');
}

/* Disk fallback (same behaviour as before Cloudinary was added) */
const diskStorage = (subfolder) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    },
  });

const makeStorage = (folder) => {
  if (useCloudinary) {
    return new CloudinaryStorage({
      cloudinary: cloudinaryInstance,
      params: { folder, allowed_formats: ALLOWED, resource_type: 'image' },
    });
  }
  return diskStorage(folder);
};

const imageFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (ALLOWED.includes(ext)) return cb(null, true);
  cb(new Error('Only image files (jpg, jpeg, png, webp, gif) are allowed.'));
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

const uploadLogo       = multer({ storage: makeStorage('logos'),      fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadEvent      = multer({ storage: makeStorage('events'),     fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadAvatar     = multer({ storage: makeStorage('avatars'),    fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadFame       = multer({ storage: makeStorage('fame'),       fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadLeadership = multer({ storage: makeStorage('leadership'), fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });

module.exports = { uploadLogo, uploadEvent, uploadAvatar, uploadFame, uploadLeadership, getFileValue };
