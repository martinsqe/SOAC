/**
 * Coordinator Authorization Middleware
 * Verifies that a coordinator has an active assignment for the requested club.
 * Admins can access any club.
 *
 * Uses assertCoordOwnsClub from coordAuth.js which implements the full 3-tier lookup:
 *   1. coordinator_club_assignments (fast path)
 *   2. users.managed_club_id        (legacy FK)
 *   3. clubs.coordinator ILIKE name (name-based rescue + auto-repair)
 */

const { assertCoordOwnsClub } = require('../services/coordAuth');

const requireCoordinatorOwnership = async (req, res, next) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'admin') return next();

    if (role === 'coordinator') {
      const clubId = req.params.id;
      if (!clubId) {
        return res.status(403).json({ message: 'You can only manage your assigned club.' });
      }

      const ok = await assertCoordOwnsClub(req.user.id, clubId);
      if (ok) return next();

      return res.status(403).json({ message: 'You can only manage your assigned club.' });
    }

    res.status(403).json({ message: 'Coordinator or admin access required.' });
  } catch (err) { next(err); }
};

module.exports = { requireCoordinatorOwnership };
