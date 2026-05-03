/**
 * Coordinator Authorization Middleware
 * Verifies that a coordinator has an active assignment for the requested club.
 * Admins can access any club.
 * Async — queries coordinator_club_assignments on every request.
 */

const { pgPool } = require('../config/db');

const requireCoordinatorOwnership = async (req, res, next) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'admin') return next();

    if (role === 'coordinator') {
      const clubId = req.params.id;
      if (!clubId) {
        return res.status(403).json({ message: 'You can only manage your assigned club.' });
      }
      // Check assignment table first
      const { rows } = await pgPool.query(
        `SELECT id FROM coordinator_club_assignments
         WHERE user_id = $1 AND club_id = $2 AND is_active = true`,
        [req.user.id, clubId]
      );
      if (rows.length) return next();

      // Fallback: legacy coordinator with managed_club_id but no assignment row yet
      const { rows: userRows } = await pgPool.query(
        `SELECT managed_club_id FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (userRows[0]?.managed_club_id && String(userRows[0].managed_club_id) === String(clubId)) {
        // Auto-migrate the assignment row for next time
        pgPool.query(
          `INSERT INTO coordinator_club_assignments (user_id, club_id, is_active)
           VALUES ($1, $2, true)
           ON CONFLICT (user_id, club_id) DO UPDATE SET is_active = true, updated_at = NOW()`,
          [req.user.id, clubId]
        ).catch(() => {});
        return next();
      }

      return res.status(403).json({ message: 'You can only manage your assigned club.' });
    }

    res.status(403).json({ message: 'Coordinator or admin access required.' });
  } catch (err) { next(err); }
};

module.exports = { requireCoordinatorOwnership };
