let _cloudinary = null;

const hasCredentials =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_SECRET;

if (hasCredentials) {
  try {
    _cloudinary = require('cloudinary').v2;
    _cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  } catch (_) {
    // Package not installed — disk storage fallback will be used
  }
}

const cloudinary = _cloudinary;

/**
 * Delete a Cloudinary image by its stored URL.
 * No-ops safely if the package isn't installed or the value is a legacy local filename.
 */
const destroyImage = async (storedValue) => {
  if (!storedValue || !cloudinary) return;
  try {
    if (!storedValue.startsWith('https://res.cloudinary.com')) return;
    const m = storedValue.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    if (!m) return;
    await cloudinary.uploader.destroy(m[1]);
  } catch (_) {}
};

module.exports = { cloudinary, destroyImage };
