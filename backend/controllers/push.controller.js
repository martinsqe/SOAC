const { pgPool } = require('../config/db');

/* ── Migration ── */
(async () => {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          BIGSERIAL     PRIMARY KEY,
        user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint    VARCHAR(1000) NOT NULL,
        p256dh      VARCHAR(255)  NOT NULL,
        auth        VARCHAR(255)  NOT NULL,
        user_agent  VARCHAR(500)  NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (endpoint)
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`);
    console.log('[push] migrations ready');
  } catch (err) {
    console.error('[push] migration failed:', err.message);
  }
})();

/* POST /api/push/subscribe  (authenticated)
   Body: PushSubscription.toJSON() shape — { endpoint, keys: { p256dh, auth } } */
const subscribe = async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'endpoint and keys.{p256dh,auth} are required.' });
    }
    await pgPool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [req.user.id, endpoint, keys.p256dh, keys.auth, (req.headers['user-agent'] || '').slice(0, 500)]
    );
    res.status(201).json({ message: 'Subscribed.' });
  } catch (err) { next(err); }
};

/* DELETE /api/push/subscribe  (authenticated)
   Body: { endpoint } — scoped to the caller's own user_id so nobody can remove
   another user's subscription by guessing an endpoint. */
const unsubscribe = async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'endpoint is required.' });
    await pgPool.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
      [endpoint, req.user.id]
    );
    res.json({ message: 'Unsubscribed.' });
  } catch (err) { next(err); }
};

module.exports = { subscribe, unsubscribe };
