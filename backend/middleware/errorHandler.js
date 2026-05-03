const errorHandler = (err, req, res, next) => {
  console.error(err);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  // PostgreSQL unique-violation error code
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Duplicate entry — a record with that value already exists.' });
  }
  res.status(err.status || 500).json({ message: err.message || 'Internal server error.' });
};

module.exports = { errorHandler };
