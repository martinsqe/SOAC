const { pgPool } = require('../config/db');

/* ── Migration ── */
(async () => {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          BIGSERIAL     PRIMARY KEY,
        user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fcm_token   VARCHAR(500)  NOT NULL,
        user_agent  VARCHAR(500)  NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (fcm_token)
      )
    `);
    /* Migrate an older raw-Web-Push version of this table (endpoint/p256dh/auth
       columns, from before the move to Firebase Cloud Messaging) to the FCM-token
       shape. A raw PushSubscription endpoint can't be converted into an FCM token,
       so old rows are dropped — every client re-subscribes automatically the next
       time it opens the app and hits the Enable banner again. */
    await pgPool.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(500)`);
    await pgPool.query(`DELETE FROM push_subscriptions WHERE fcm_token IS NULL`);
    await pgPool.query(`ALTER TABLE push_subscriptions ALTER COLUMN fcm_token SET NOT NULL`);
    await pgPool.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS endpoint`);
    await pgPool.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS p256dh`);
    await pgPool.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS auth`);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_fcm_token_key ON push_subscriptions(fcm_token)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`);
    console.log('[push] migrations ready');
  } catch (err) {
    console.error('[push] migration failed:', err.message);
  }
})();

/* POST /api/push/subscribe  (authenticated)
   Body: { token } — the FCM registration token from getToken(). */
const subscribe = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'token is required.' });
    await pgPool.query(
      `INSERT INTO push_subscriptions (user_id, fcm_token, user_agent)
       VALUES ($1, $2, $3)
       ON CONFLICT (fcm_token) DO UPDATE SET
         user_id = EXCLUDED.user_id, user_agent = EXCLUDED.user_agent`,
      [req.user.id, token, (req.headers['user-agent'] || '').slice(0, 500)]
    );
    res.status(201).json({ message: 'Subscribed.' });
  } catch (err) { next(err); }
};

/* DELETE /api/push/subscribe  (authenticated)
   Body: { token } — scoped to the caller's own user_id so nobody can remove
   another user's subscription by guessing a token. */
const unsubscribe = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'token is required.' });
    await pgPool.query(
      `DELETE FROM push_subscriptions WHERE fcm_token = $1 AND user_id = $2`,
      [token, req.user.id]
    );
    res.json({ message: 'Unsubscribed.' });
  } catch (err) { next(err); }
};

module.exports = { subscribe, unsubscribe };
