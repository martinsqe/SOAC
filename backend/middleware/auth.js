const jwt = require('jsonwebtoken');
const tokenBlacklist = require('../services/tokenBlacklist');

const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token was revoked (e.g., on logout)
    const revoked = await tokenBlacklist.isRevoked(token);
    if (revoked) {
      return res.status(401).json({ message: 'Token has been revoked. Please log in again.' });
    }
    
    // Check if user revoked all their tokens (e.g., password change)
    const userRevoked = await tokenBlacklist.wasRevokedByUser(decoded.id, decoded.iat);
    if (userRevoked) {
      return res.status(401).json({ message: 'Your session was invalidated due to a security event. Please log in again.' });
    }
    
    req.user = decoded; // { id, email, name, role, iat }
    req.token = token; // Store token for revocation on logout
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token has expired.' });
    }
    return res.status(401).json({ message: 'Token is invalid or malformed.' });
  }
};

module.exports = { verifyToken };
