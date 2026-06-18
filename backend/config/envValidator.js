const validateEnv = () => {
  const errors = [];
  const warnings = [];

  // ── Database ──────────────────────────────────────────────────────────────
  // Railway provides DATABASE_URL; local dev uses individual PG_* vars.
  const hasDbUrl = !!process.env.DATABASE_URL;
  if (!hasDbUrl) {
    for (const v of ['PG_HOST', 'PG_PORT', 'PG_DB', 'PG_USER', 'PG_PASSWORD']) {
      if (!process.env[v]) errors.push(`❌ Missing ${v} (or set DATABASE_URL)`);
    }
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  // Railway provides REDIS_URL; local dev uses REDIS_HOST + REDIS_PORT.
  const hasRedisUrl = !!process.env.REDIS_URL;
  if (!hasRedisUrl && !process.env.REDIS_HOST) {
    errors.push('❌ Redis config missing: set REDIS_URL (Railway) or REDIS_HOST + REDIS_PORT (local)');
  }

  // ── JWT ───────────────────────────────────────────────────────────────────
  for (const v of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'RESET_PASSWORD_SECRET']) {
    if (!process.env[v]) errors.push(`❌ Missing required JWT env var: ${v}`);
  }

  // ── App ───────────────────────────────────────────────────────────────────
  const nodeEnv = process.env.NODE_ENV;
  if (!nodeEnv) {
    errors.push('❌ Missing NODE_ENV');
  } else if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`❌ Invalid NODE_ENV: must be development|production|test, got: ${nodeEnv}`);
  }

  // ── SMTP (optional — app works without email, features degrade gracefully) ─
  const smtpVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missingSMTP = smtpVars.filter(v => !process.env[v]);
  if (missingSMTP.length > 0) {
    warnings.push(`⚠️  SMTP not fully configured (${missingSMTP.join(', ')} missing) — email features disabled`);
  }

  // ── Production-specific ───────────────────────────────────────────────────
  if (nodeEnv === 'production') {
    if (!process.env.CLIENT_URL) errors.push('❌ Missing CLIENT_URL (required in production for CORS)');
    if (!process.env.ADMIN_EMAIL) warnings.push('⚠️  ADMIN_EMAIL not set — admin seed may use default');
  }

  // ── Format validation ─────────────────────────────────────────────────────
  const pgPort = process.env.PG_PORT;
  if (pgPort && (isNaN(pgPort) || pgPort < 1 || pgPort > 65535)) {
    errors.push('❌ Invalid PG_PORT: must be 1-65535');
  }
  const redisPort = process.env.REDIS_PORT;
  if (redisPort && (isNaN(redisPort) || redisPort < 1 || redisPort > 65535)) {
    errors.push('❌ Invalid REDIS_PORT: must be 1-65535');
  }

  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(w));
  }

  if (errors.length > 0) {
    console.error('\n🚨 ENVIRONMENT CONFIGURATION ERRORS:\n');
    errors.forEach(e => console.error(e));
    console.error('\n');
    process.exit(1);
  }

  console.log('✅ Environment validation passed');
};

module.exports = { validateEnv };
