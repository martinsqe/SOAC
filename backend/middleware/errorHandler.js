const errorHandler = (err, req, res, next) => {
  console.error('[errorHandler]', err);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  // PostgreSQL unique-violation error code
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Duplicate entry — a record with that value already exists.' });
  }
  // Extract message from plain objects (e.g. multer-storage-cloudinary wraps errors as { error: { message, http_code } })
  const msg = err.message
    || (err.error && err.error.message)
    || (typeof err === 'string' ? err : null)
    || 'Internal server error.';
  // NEVER forward a 3rd-party http_code (e.g. Cloudinary 401) as the HTTP status —
  // that would make the browser think the user's session expired.
  res.status(err.status || 500).json({ message: msg });
};

module.exports = { errorHandler };
