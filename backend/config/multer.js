const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const makeStorage = (subdir) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', subdir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext)
                       .replace(/\s+/g, '-')
                       .toLowerCase();
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  });

const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) return cb(null, true);
  cb(new Error('Only image files (jpg, jpeg, png, webp, gif) are allowed.'));
};

const uploadLogo       = multer({ storage: makeStorage('logos'),      fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadEvent      = multer({ storage: makeStorage('events'),     fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadAvatar     = multer({ storage: makeStorage('avatars'),    fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadFame       = multer({ storage: makeStorage('fame'),       fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadLeadership = multer({ storage: makeStorage('leadership'), fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });

module.exports = { uploadLogo, uploadEvent, uploadAvatar, uploadFame, uploadLeadership };
