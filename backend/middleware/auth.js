const jwt = require('jsonwebtoken');
const tokenBlacklist = require('../services/tokenBlacklist');

/* Main SOAC access tokens only: HS256, signed with JWT_SECRET, carrying a user
   id and role and no `purpose` claim. Galore-portal and student-verification
   tokens use their own secrets (config/secrets.js) and also carry `purpose`,
   so they are rejected here twice over. */
const decodeAccessToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  if (decoded.purpose || !Number.isInteger(decoded.id) || !decoded.role) {
    const err = new Error('Not an access token');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
};

const REVOKED_MESSAGE = {
  revoked:      'Token has been revoked. Please log in again.',
  user_revoked: 'Your session was invalidated due to a security event. Please log in again.',
  unavailable:  'Could not verify your session right now. Please try again.',
};

const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }

  const token = header.split(' ')[1];
  let decoded;
  try {
    decoded = decodeAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token has expired.' });
    }
    return res.status(401).json({ message: 'Token is invalid or malformed.' });
  }

  const reason = await tokenBlacklist.checkToken(token, decoded.id, decoded.iat);
  if (reason) {
    return res.status(reason === 'unavailable' ? 503 : 401).json({ message: REVOKED_MESSAGE[reason] });
  }

  req.user = decoded; // { id, email, name, role, iat }
  req.token = token;  // Stored for revocation on logout
  next();
};

/* For public routes whose answer depends on who's asking (e.g. the admin's
   campus-scoped club / event lists): sets req.user when a valid, unrevoked token
   is sent, and otherwise carries on as a guest — never rejects the request. */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  const token = header.split(' ')[1];
  try {
    const decoded = decodeAccessToken(token);
    if (!(await tokenBlacklist.checkToken(token, decoded.id, decoded.iat))) {
      req.user = decoded;
      req.token = token;
    }
  } catch { /* invalid or expired token — treat as a guest */ }
  next();
};

module.exports = { verifyToken, optionalAuth, decodeAccessToken };
