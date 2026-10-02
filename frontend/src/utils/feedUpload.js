import api from '../api/client';

/* ── Posting a photo / video to the Club Feed, fast ──────────────────────────
   1. Photos are shrunk in the browser first (longest side 1920px, JPEG) — a
      3–8 MB phone photo becomes a few hundred KB, which the feed can't tell apart.
   2. The file goes STRAIGHT to Cloudinary using a short-lived signature from our
      server, with real upload progress — it never passes through our server.
   3. Our server then saves the post with the uploaded URL.
   If direct upload isn't available (Cloudinary not configured), the file is
   posted to our server the old way. */

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.82;
export const MAX_VIDEO_MB = 50;

const loadImage = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = URL.createObjectURL(file);
});

/* Smaller JPEG for big photos; returns the original if it's already small, a
   GIF (could be animated), or if shrinking wouldn't actually save anything */
export async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400 * 1024) return file;
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                 // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;                            // couldn't decode — upload as-is
  }
}

/* multipart POST with upload progress (fetch can't report upload progress) */
const xhrUpload = (url, formData, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
    if (xhr.status >= 200 && xhr.status < 300) resolve(body);
    else reject(new Error(body?.error?.message || `Upload failed (${xhr.status})`));
  };
  xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
  xhr.send(formData);
});

/* onProgress(stage, percent) — stage is 'preparing' | 'uploading' | 'saving' */
export async function postToClubFeed({ clubId, caption, file, onProgress = () => {} }) {
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  if (kind === 'video' && file.size > MAX_VIDEO_MB * 1024 * 1024) {
    throw new Error(`Videos can be up to ${MAX_VIDEO_MB} MB. Please choose a shorter clip.`);
  }

  onProgress('preparing', 0);
  const toSend = kind === 'image' ? await compressImage(file) : file;
  const sig = await api.post('/club-feed/upload-signature', { clubId, kind });

  if (!sig.direct) {
    onProgress('uploading', 0);
    const fd = new FormData();
    fd.append('clubId', clubId);
    fd.append('caption', caption);
    fd.append('media', toSend);
    const res = await api.postForm('/club-feed', fd);
    onProgress('saving', 100);
    return res;
  }

  const fd = new FormData();
  fd.append('file', toSend);
  fd.append('api_key', sig.apiKey);
  fd.append('timestamp', sig.timestamp);
  fd.append('folder', sig.folder);
  fd.append('allowed_formats', sig.allowed_formats);
  fd.append('signature', sig.signature);
  const uploaded = await xhrUpload(
    `https://api.cloudinary.com/v1_1/${sig.cloudName}/${sig.resourceType}/upload`,
    fd,
    (pct) => onProgress('uploading', pct),
  );

  onProgress('saving', 100);
  return api.post('/club-feed', {
    clubId, caption,
    mediaUrl:  uploaded.secure_url,
    mediaType: sig.resourceType,
    width:     uploaded.width  || 0,
    height:    uploaded.height || 0,
  });
}

/* Button text for the current step */
export const progressLabel = (p) => (!p ? null
  : p.stage === 'preparing' ? 'Preparing…'
  : p.stage === 'uploading' ? `Uploading ${p.pct}%`
  : 'Saving…');
