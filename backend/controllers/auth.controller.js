const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { pgPool } = require('../config/db');
const { sendPasswordReset } = require('../config/email');
const cache = require('../services/cache');
const tokenBlacklist = require('../services/tokenBlacklist');
const { getCoordClubIds } = require('../services/coordAuth');
const { ACCOUNT_LABEL, PROFILE_LABEL, matchesOtherAccount, SAME_PASSWORD_MESSAGE, otherProfile, loginProfileFor } = require('../services/accounts');

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 30;

/* ── Token helpers ────────────────────────────────────────────────────────── */
const signAccess = (user) =>
  jwt.sign(
    {
      id:    user.id,
      email: user.email,
      name:  user.name,
      role:  user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

const signRefresh = (user) =>
  jwt.sign(
    { id: user.id, tokenFamily: crypto.randomBytes(4).toString('hex') },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );

const signPasswordReset = (user) => {
  const pwdVersion = crypto.createHash('sha256').update(user.password_hash).digest('hex').slice(0, 16);
  return jwt.sign(
    { id: user.id, pv: pwdVersion, purpose: 'password-reset' },
    process.env.RESET_PASSWORD_SECRET,
    { expiresIn: process.env.RESET_PASSWORD_EXPIRES_IN || '30m' }
  );
};

/* ── Account lockout helpers ────────────────────────────────────────────────── */
const recordFailedLogin = async (email) => {
  const key = `failed_login:${email}`;
  const attempts = await cache.incr(key);
  if (attempts === 1) {
    await cache.expire(key, LOGIN_LOCKOUT_MINUTES * 60);
  }
  return attempts;
};

const resetFailedLogins = async (email) => {
  await cache.del(`failed_login:${email}`);
};

const isAccountLocked = async (email) => {
  const key = `failed_login:${email}`;
  const attempts = await cache.get(key);
  return attempts && parseInt(attempts, 10) >= MAX_LOGIN_ATTEMPTS;
};

/* ── Normalise a DB user row into the API response shape (always camelCase) ─ */
const toUserResponse = (u) => ({
  id:                 u.id,
  email:              u.email,
  name:               u.name,
  role:               u.role,
  avatar:             u.avatar || '',
  mustChangePassword: !!u.must_change_password,
  managedClubId:      u.managed_club_id || null,
  isActive:           !!u.is_active,
  lastLogin:          u.last_login || null,
});

/* Same shape, plus the person's other profile (student <-> coordinator / advisor)
   they can switch to with one login — null when they only have one */
const withProfiles = async (u) => {
  const other = await otherProfile(u.id);
  return {
    ...toUserResponse(u),
    switchTo: other ? { role: other.role, label: PROFILE_LABEL[other.role] || 'Other dashboard' } : null,
  };
};

/* Issue access + refresh tokens for a user row and set the refresh cookie */
const startSession = async (res, user) => {
  const accessToken  = signAccess(user);
  const refreshToken = signRefresh(user);
  const tokenHash    = await bcrypt.hash(refreshToken, 10);
  await pgPool.query(
    `INSERT INTO auth_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, tokenHash]
  );
  // Session flag the refresh endpoint checks; drop any stale /me cache
  await cache.set(`session:tokens:${user.id}`, 1, cache.TTL.SESSION_TOKEN);
  await cache.del(`session:user:${user.id}`);
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
  return accessToken;
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/login
   All users (admin, coordinator, student) authenticate through the users table.
   Coordinators are stored in users with role = 'coordinator'.
   Implements account lockout after 5 failed attempts.
───────────────────────────────────────────────────────────────────────────── */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }
    const normalizedEmail = email.toLowerCase();

    // Check account lockout
    const locked = await isAccountLocked(normalizedEmail);
    if (locked) {
      return res.status(429).json({ 
        message: `Account locked due to too many failed login attempts. Try again in ${LOGIN_LOCKOUT_MINUTES} minutes.` 
      });
    }

    /* A person may have a student and a coordinator / advisor profile. They sign
       in with ONE login — the profile holding the password — and switch to the
       other inside the app; linked profiles can't be signed into directly. */
    const { rows } = await pgPool.query(
      `SELECT id, email, name, role, password_hash, is_active,
              must_change_password, managed_club_id, avatar
       FROM users WHERE LOWER(email) = $1 AND is_active = true AND NOT linked_profile
       ORDER BY last_login DESC NULLS LAST, id`,
      [normalizedEmail]
    );

    if (!rows.length) {
      await recordFailedLogin(normalizedEmail);
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    let user = null;
    for (const candidate of rows) {
      if (await bcrypt.compare(password, candidate.password_hash)) { user = candidate; break; }
    }
    if (!user) {
      const attempts = await recordFailedLogin(normalizedEmail);
      const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - attempts);
      return res.status(401).json({ message: 'Invalid email or password.', attemptsRemaining: remaining });
    }

    // Successful login — reset failed attempts
    await resetFailedLogins(normalizedEmail);
    await pgPool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    // Coordinators: resolve club assignments (auto-repair legacy rows) before responding
    if (user.role === 'coordinator' || user.role === 'faculty_coordinator') {
      const clubIds = await getCoordClubIds(user.id);
      if (clubIds.length && !user.managed_club_id) {
        await pgPool.query(
          `UPDATE users SET managed_club_id = $1 WHERE id = $2`,
          [clubIds[0], user.id]
        );
        user.managed_club_id = clubIds[0];
      }
    }

    const accessToken = await startSession(res, user);
    res.json({ accessToken, user: await withProfiles(user) });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/logout
   Revoke access token + all refresh tokens for user
───────────────────────────────────────────────────────────────────────────── */
const logout = async (req, res, next) => {
  try {
    if (req.user?.id) {
      // Revoke current access token
      if (req.token) {
        const expiresIn = Math.ceil((req.user.exp * 1000 - Date.now()) / 1000);
        if (expiresIn > 0) {
          await tokenBlacklist.revokeToken(req.token, expiresIn);
        }
      }
      
      // Revoke all refresh tokens for this user
      await pgPool.query(
        'UPDATE auth_tokens SET revoked = true WHERE user_id = $1',
        [req.user.id]
      );
      
      // Clear session cache
      await cache.del(
        `session:tokens:${req.user.id}`,
        `session:user:${req.user.id}`
      );
    }
    
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully.' });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/auth/me
   Cache-aside: session:user:<id> → 60 s
   Returns the same camelCase shape as login / refresh.
───────────────────────────────────────────────────────────────────────────── */
const me = async (req, res, next) => {
  try {
    const cacheKey = `session:user:${req.user.id}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT id, email, name, role, is_active, must_change_password,
              managed_club_id, avatar, last_login
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ message: 'User not found or inactive.' });
    }

    const dbUser = rows[0];
    if (dbUser.role === 'coordinator' || dbUser.role === 'faculty_coordinator') {
      const clubIds = await getCoordClubIds(dbUser.id);
      if (clubIds.length && !dbUser.managed_club_id) {
        await pgPool.query(
          `UPDATE users SET managed_club_id = $1 WHERE id = $2`,
          [clubIds[0], dbUser.id]
        );
        dbUser.managed_club_id = clubIds[0];
      }
    }

    const result = { user: await withProfiles(dbUser) };
    await cache.set(cacheKey, result, cache.TTL.SESSION);
    res.json(result);
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/change-password
   Revokes all sessions (forces re-login)
───────────────────────────────────────────────────────────────────────────── */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    /* Always the profile that holds the login — on a linked profile (e.g. the
       coordinator dashboard reached by switching) that's the profile it's linked to */
    const user = await loginProfileFor(req.user.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'User not found or inactive.' });
    }
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }
    if (await matchesOtherAccount(user.id, newPassword)) {
      return res.status(400).json({ message: SAME_PASSWORD_MESSAGE });
    }
    const hash = await bcrypt.hash(String(newPassword), 12);
    await pgPool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
      [hash, user.id]
    );

    // Sign out every session of both profiles — the person signs in again with the new password
    for (const id of [...new Set([req.user.id, user.id])]) {
      await tokenBlacklist.revokeAllUserTokens(id);
      await pgPool.query('UPDATE auth_tokens SET revoked = true WHERE user_id = $1', [id]);
      await cache.del(`session:user:${id}`, `session:tokens:${id}`);
    }

    res.json({ message: 'Password changed successfully. Please log in again.' });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/refresh
   Implements refresh token rotation: 
   - Validate old refresh token
   - Issue new refresh token
   - Invalidate old refresh token
───────────────────────────────────────────────────────────────────────────── */
const refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ message: 'No refresh token.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Refresh token expired. Please log in again.' });
      }
      return res.status(401).json({ message: 'Refresh token invalid or malformed.' });
    }

    const { rows } = await pgPool.query(
      `SELECT id, email, name, role, is_active, must_change_password,
              managed_club_id, avatar
       FROM users WHERE id = $1 AND is_active = true`,
      [payload.id]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'User not found or inactive.' });
    }

    // Session token optimisation: Redis first, fall back to auth_tokens table
    const sessionValid = await cache.get(`session:tokens:${payload.id}`);
    if (!sessionValid) {
      const tokenRes = await pgPool.query(
        `SELECT id FROM auth_tokens
         WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
         LIMIT 1`,
        [payload.id]
      );
      if (!tokenRes.rows.length) {
        return res.status(401).json({ message: 'Session expired. Please log in again.' });
      }
      await cache.set(`session:tokens:${payload.id}`, 1, cache.TTL.SESSION_TOKEN);
    }

    const user = rows[0];

    const newAccessToken  = signAccess(user);
    const newRefreshToken = signRefresh(user); // Rotate token
    const newTokenHash    = await bcrypt.hash(newRefreshToken, 10);

    // Issue new refresh token
    await pgPool.query(
      `INSERT INTO auth_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, newTokenHash]
    );

    // Invalidate old refresh token by blacklisting it
    // (prevents token reuse if compromised; client must use new token)
    const expiresIn = Math.ceil((payload.exp * 1000 - Date.now()) / 1000);
    if (expiresIn > 0) {
      await tokenBlacklist.revokeToken(token, expiresIn);
    }

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });

    res.json({ accessToken: newAccessToken, user: await withProfiles(user) });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/forgot-password
───────────────────────────────────────────────────────────────────────────── */
const forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    /* Only profiles that hold a login get a reset link — a linked profile shares
       its partner's password. (Two separately-created logins on one email each
       get their own, labelled link.) */
    const { rows } = await pgPool.query(
      `SELECT id, email, name, role, password_hash FROM users
       WHERE LOWER(email) = $1 AND is_active = true AND NOT linked_profile ORDER BY (role = 'student') DESC`,
      [email]
    );

    // Only existing, active accounts can request a reset link
    if (!rows.length) {
      return res.status(404).json({ message: 'You are not a member of any club.' });
    }

    // Reply straight away — sending (with provider retries/failover) can take well over
    // a minute when a mail provider is slow, long enough for the proxy to return a 502.
    for (const user of rows) {
      sendPasswordReset({
        toEmail: user.email, toName: user.name, token: signPasswordReset(user),
        accountLabel: rows.length > 1 ? ACCOUNT_LABEL[user.role] : null,
      }).catch(err => console.error(`Failed to send password reset email to ${user.email}:`, err.message));
    }

    return res.json({
      message: rows.length > 1
        ? 'Password reset links have been sent to your email — one for each of your accounts.'
        : 'A password reset link has been sent to your email.',
    });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/reset-password
   Token is bound to the current password hash — can't reuse after a reset.
   Revokes all user sessions.
───────────────────────────────────────────────────────────────────────────── */
const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ message: 'Token and a new password (min 8 chars) are required.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.RESET_PASSWORD_SECRET);
    } catch {
      return res.status(400).json({ message: 'Reset link is invalid or expired.' });
    }
    if (payload.purpose !== 'password-reset') {
      return res.status(400).json({ message: 'Reset token is invalid.' });
    }

    const { rows } = await pgPool.query(
      'SELECT id, password_hash, is_active FROM users WHERE id = $1 LIMIT 1',
      [payload.id]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(400).json({ message: 'Reset link is invalid or expired.' });
    }

    const user      = rows[0];
    const currentPv = crypto.createHash('sha256').update(user.password_hash).digest('hex').slice(0, 16);
    if (payload.pv !== currentPv) {
      return res.status(400).json({ message: 'This reset link has already been used.' });
    }
    if (await matchesOtherAccount(user.id, newPassword)) {
      return res.status(400).json({ message: SAME_PASSWORD_MESSAGE });
    }

    const hash = await bcrypt.hash(String(newPassword), 12);
    await pgPool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
      [hash, user.id]
    );

    // Revoke all user sessions (forces re-login)
    await tokenBlacklist.revokeAllUserTokens(user.id);
    await pgPool.query('UPDATE auth_tokens SET revoked = true WHERE user_id = $1', [user.id]);
    await cache.del(`session:user:${user.id}`, `session:tokens:${user.id}`);

    res.json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/auth/switch-profile
   One login, two profiles: a student who is also a Student Coordinator (or a
   coordinator who is also a club member) switches between the student and the
   coordinator dashboards without signing in again. Issues a session for the
   person's other profile.
───────────────────────────────────────────────────────────────────────────── */
const switchProfile = async (req, res, next) => {
  try {
    const other = await otherProfile(req.user.id);
    if (!other) return res.status(404).json({ message: 'You have no other profile to switch to.' });
    if (other.role === 'coordinator' || other.role === 'faculty_coordinator') {
      const clubIds = await getCoordClubIds(other.id);
      if (clubIds.length && !other.managed_club_id) {
        await pgPool.query(`UPDATE users SET managed_club_id = $1 WHERE id = $2`, [clubIds[0], other.id]);
        other.managed_club_id = clubIds[0];
      }
    }
    await pgPool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [other.id]);
    const accessToken = await startSession(res, other);
    res.json({ accessToken, user: await withProfiles(other) });
  } catch (err) { next(err); }
};

module.exports = { login, logout, me, changePassword, refresh, forgotPassword, resetPassword, switchProfile };
