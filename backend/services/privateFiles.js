const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { cloudinaryInstance, useCloudinary, safeName } = require('../config/multer');
const { fileLinkSecret } = require('../config/secrets');

/* Files that hold students' personal data (activity proofs, …).
 *
 * They are NEVER publicly reachable:
 *   • Cloudinary: uploaded as type 'authenticated' — the plain delivery URL
 *     returns 401; a time-limited signed download URL is minted per viewer.
 *   • Disk: written to backend/private/ (outside the public /uploads static
 *     folder) and streamed only through GET /api/files/:token, where the token
 *     is a short-lived signature for that one file.
 * Callers check WHO may see a file; this module only stores files and mints
 * short-lived links for viewers who have already been authorised.
 *
 * Stored DB value:  cld:<resource_type>:<public_id>[:<format>]  or  disk:<folder>/<name>
 */

const PRIVATE_ROOT = path.join(__dirname, '..', 'private');
const LINK_SECONDS = 60 * 60;   // a viewer's link works for one hour

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const extOf = (name = '') => String(name).split('.').pop().toLowerCase();

/* Store an uploaded (memoryStorage) file privately; returns the DB value */
async function savePrivateFile(file, folder, timeoutMs = 30000) {
  const ext = extOf(file.originalname);
  if (useCloudinary) {
    const isImage = IMAGE_EXT.includes(ext);
    const id = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        const stream = cloudinaryInstance.uploader.upload_stream(
          {
            folder, type: 'authenticated',
            resource_type: isImage ? 'image' : 'raw',
            public_id: isImage ? id : `${id}.${ext}`,
          },
          (err, r) => (err ? reject(err) : resolve(r))
        );
        stream.end(file.buffer);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out')), timeoutMs)),
    ]);
    return `cld:${result.resource_type}:${result.public_id}${result.format ? `:${result.format}` : ''}`;
  }
  const dir = path.join(PRIVATE_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = safeName(file.originalname);
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return `disk:${folder}/${name}`;
}

/* Absolute path for a disk value — refuses anything that would escape private/ */
function diskPath(rel) {
  const full = path.resolve(PRIVATE_ROOT, rel);
  if (!full.startsWith(PRIVATE_ROOT + path.sep)) throw new Error('Invalid file path');
  return full;
}

/* A short-lived URL for someone ALREADY authorised to see this file.
   Values from before private storage (plain URLs) are returned unchanged. */
function privateFileUrl(stored, { downloadName = '' } = {}) {
  if (!stored) return '';
  if (stored.startsWith('cld:') && useCloudinary) {
    const [, resourceType, publicId, format] = stored.split(':');
    return cloudinaryInstance.utils.private_download_url(publicId, format || '', {
      resource_type: resourceType,
      type: 'authenticated',
      attachment: false,
      expires_at: Math.floor(Date.now() / 1000) + LINK_SECONDS,
    });
  }
  if (stored.startsWith('disk:')) {
    const token = jwt.sign({ f: stored.slice(5), n: String(downloadName).slice(0, 120), purpose: 'file' },
      fileLinkSecret(), { expiresIn: LINK_SECONDS, algorithm: 'HS256' });
    return `/api/files/${encodeURIComponent(token)}`;
  }
  return stored;
}

/* GET /api/files/:token — streams a private disk file for a valid link */
function serveFileLink(req, res) {
  let payload;
  try {
    payload = jwt.verify(req.params.token, fileLinkSecret(), { algorithms: ['HS256'] });
    if (payload.purpose !== 'file') throw new Error('wrong token');
  } catch {
    return res.status(403).json({ message: 'This link has expired. Go back and open the file again.' });
  }
  let full;
  try { full = diskPath(payload.f); } catch { return res.status(400).json({ message: 'Invalid file.' }); }
  if (!fs.existsSync(full)) return res.status(404).json({ message: 'File not found.' });

  const ext = extOf(full);
  const name = (payload.n || path.basename(full)).replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${['pdf', ...IMAGE_EXT].includes(ext) ? 'inline' : 'attachment'}; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (ext !== 'pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  fs.createReadStream(full).pipe(res);
}

async function deletePrivateFile(stored) {
  try {
    if (stored?.startsWith('cld:') && useCloudinary) {
      const [, resourceType, publicId] = stored.split(':');
      await cloudinaryInstance.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated' });
    } else if (stored?.startsWith('disk:')) {
      fs.unlinkSync(diskPath(stored.slice(5)));
    }
  } catch { /* already gone — nothing to clean up */ }
}

const isImageFile = (stored = '', name = '') =>
  stored.startsWith('cld:image:') || IMAGE_EXT.includes(extOf(name)) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(stored);

module.exports = { savePrivateFile, privateFileUrl, serveFileLink, deletePrivateFile, isImageFile };
