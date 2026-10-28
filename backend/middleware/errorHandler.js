const errorHandler = (err, req, res, next) => {
  console.error('[errorHandler]', err);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  // PostgreSQL unique-violation error code
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Duplicate entry — a record with that value already exists.' });
  }
  // Request body over the size cap (express.json / urlencoded)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'That request is too large.' });
  }
  // Extract message from plain objects (e.g. multer-storage-cloudinary wraps errors as { error: { message, http_code } })
  const msg = err.message
    || (err.error && err.error.message)
    || (typeof err === 'string' ? err : null)
    || 'Internal server error.';
  // NEVER forward a 3rd-party http_code (e.g. Cloudinary 401) as the HTTP status —
  // that would make the browser think the user's session expired.
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  /* A 4xx carries a message written for the user. A 5xx message is internal
     (SQL errors name tables, columns and constraints) — never shown in production. */
  const safe = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({ message: safe ? msg : 'Something went wrong on our side. Please try again.' });
};

module.exports = { errorHandler };
