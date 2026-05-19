/**
 * coordAuth.js — Shared coordinator authorization helper
 *
 * Solves the "No Club Assigned" problem for coordinators whose
 * coordinator_club_assignments rows were not persisted (e.g. assigned
 * before the table existed, or due to a constraint failure).
 *
 * Usage:
 *   const { getCoordClubIds, assertCoordOwnsClub } = require('../services/coordAuth');
 *
 *   // Get all club IDs this coordinator manages (with auto-repair)
 *   const clubIds = await getCoordClubIds(pgPool, userId);
 *
 *   // Check + auto-repair a single club; returns true if authorized
 *   const ok = await assertCoordOwnsClub(pgPool, userId, clubId);
 */
const { pgPool } = require('../config/db');

/**
 * Auto-repair helper: insert a coordinator_club_assignments row.
 * Fire-and-forget; errors are logged but not propagated.
 */
function autoRepair(userId, clubId) {
  pgPool.query(
    `INSERT INTO coordinator_club_assignments (user_id, club_id, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (user_id, club_id)
     DO UPDATE SET is_active = true, updated_at = NOW()`,
    [userId, clubId]
  ).catch(err => console.warn('[coordAuth] auto-repair failed:', err.message));
}

/**
 * Returns all club IDs this coordinator is authorized to manage.
 * Three-tier lookup with auto-repair on fallback paths:
 *   1. coordinator_club_assignments (fast path)
 *   2. users.managed_club_id       (legacy FK)
 *   3. clubs.coordinator ILIKE name (name-based rescue for early assignments)
 *
 * @param {number} userId
 * @returns {Promise<string[]>} Array of club ID strings (may be empty)
 */
async function getCoordClubIds(userId) {
  // ── Fast path ──
  const { rows: asgn } = await pgPool.query(
    `SELECT club_id FROM coordinator_club_assignments
     WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  if (asgn.length) return asgn.map(r => String(r.club_id));

  // ── Fallback 1: legacy managed_club_id ──
  const { rows: uRows } = await pgPool.query(
    `SELECT managed_club_id, name, email FROM users WHERE id = $1`,
    [userId]
  );
  const legacyId  = uRows[0]?.managed_club_id;
  const coordName = (uRows[0]?.name || '').trim();
  const coordEmail = (uRows[0]?.email || '').trim().toLowerCase();

  if (legacyId) {
    const { rows: check } = await pgPool.query(
      `SELECT id FROM clubs WHERE id = $1 AND is_active = true`, [legacyId]
    );
    if (check.length) {
      autoRepair(userId, legacyId);
      return [String(legacyId)];
    }
  }

  // ── Fallback 2: clubs.coordinator name match (trimmed / partial) ──
  if (coordName) {
    const { rows: nameMatch } = await pgPool.query(
      `SELECT id FROM clubs
       WHERE is_active = true
         AND (
           trim(coordinator) ILIKE trim($1)
           OR coordinator ILIKE '%' || trim($1) || '%'
         )
       ORDER BY created_at ASC`,
      [coordName]
    );
    if (nameMatch.length) {
      const ids = nameMatch.map(r => String(r.id));
      ids.forEach(clubId => autoRepair(userId, clubId));
      console.info(`[coordAuth] Auto-repaired ${ids.length} assignment(s) for coordinator ${userId} (${coordName}).`);
      return ids;
    }
  }

  // ── Fallback 3: legacy coordinator_accounts table (pre-users migration) ──
  if (coordEmail) {
    try {
      const { rows: legacyAccts } = await pgPool.query(
        `SELECT managed_club_id FROM coordinator_accounts
         WHERE lower(email) = $1 AND is_active = true`,
        [coordEmail]
      );
      const ids = [];
      for (const row of legacyAccts) {
        const clubId = row.managed_club_id;
        const { rows: check } = await pgPool.query(
          `SELECT id FROM clubs WHERE id::text = $1::text AND is_active = true`,
          [String(clubId)]
        );
        if (check.length) {
          ids.push(String(check[0].id));
          autoRepair(userId, check[0].id);
        }
      }
      if (ids.length) {
        console.info(`[coordAuth] Migrated ${ids.length} legacy coordinator_account(s) for user ${userId}.`);
        return ids;
      }
    } catch (err) {
      if (err.code !== '42P01') throw err; // table missing on fresh installs
    }
  }

  return [];
}

/**
 * Returns true if the coordinator owns (or name-matches) the given club.
 * Auto-repairs the assignment row if found via fallback.
 *
 * @param {number} userId
 * @param {string|number} clubId
 * @returns {Promise<boolean>}
 */
async function assertCoordOwnsClub(userId, clubId) {
  // Fast path
  const { rows } = await pgPool.query(
    `SELECT id FROM coordinator_club_assignments
     WHERE user_id = $1 AND club_id = $2 AND is_active = true`,
    [userId, clubId]
  );
  if (rows.length) return true;

  // Fallback 1: legacy managed_club_id
  const { rows: uRows } = await pgPool.query(
    `SELECT managed_club_id, name FROM users WHERE id = $1`, [userId]
  );
  if (uRows[0]?.managed_club_id && String(uRows[0].managed_club_id) === String(clubId)) {
    autoRepair(userId, clubId);
    return true;
  }

  // Fallback 2: clubs.coordinator name match
  const coordName = (uRows[0]?.name || '').trim();
  if (coordName) {
    const { rows: nameMatch } = await pgPool.query(
      `SELECT id FROM clubs
       WHERE id = $1 AND is_active = true
         AND (
           trim(coordinator) ILIKE trim($2)
           OR coordinator ILIKE '%' || trim($2) || '%'
         )`,
      [clubId, coordName]
    );
    if (nameMatch.length) {
      autoRepair(userId, clubId);
      console.info(`[coordAuth] Auto-repaired assignment for coordinator ${userId} (${coordName}) → club ${clubId}.`);
      return true;
    }
  }

  return false;
}

module.exports = { getCoordClubIds, assertCoordOwnsClub };
