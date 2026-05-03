/**
 * In-memory per-user rate limiter for message sends.
 * Default: max 20 messages per 10-second window.
 * Rejects with 429 when exceeded.
 */
const buckets = new Map(); // userId → timestamp[]

module.exports = function msgRateLimit(maxCount = 20, windowMs = 10_000) {
  return (req, res, next) => {
    const uid = req.user?.id;
    if (!uid) return next();

    const now   = Date.now();
    const times = (buckets.get(uid) || []).filter(t => now - t < windowMs);

    if (times.length >= maxCount) {
      return res.status(429).json({ message: 'You\'re sending too fast. Please slow down.' });
    }

    times.push(now);
    buckets.set(uid, times);

    /* Periodic cleanup so the map doesn't grow unbounded */
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (!v.some(t => now - t < windowMs)) buckets.delete(k);
      }
    }

    next();
  };
};
