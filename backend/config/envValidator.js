/**
 * Environment Variable Validator
 * Ensures all required config is present and valid on startup
 * Prevents cryptic errors downstream
 */

const required = {
  DATABASE: [
    'PG_HOST',
    'PG_PORT',
    'PG_DB',
    'PG_USER',
    'PG_PASSWORD',
  ],
  REDIS: [
    'REDIS_HOST',
    'REDIS_PORT',
  ],
  JWT: [
    'JWT_SECRET',
    'REFRESH_TOKEN_SECRET',
    'RESET_PASSWORD_SECRET',
  ],
  NOTIFICATIONS: [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
  ],
  APP: [
    'NODE_ENV',
  ],
};

const validateEnv = () => {
  const errors = [];

  // Check all required variables
  for (const [category, vars] of Object.entries(required)) {
    for (const varName of vars) {
      if (!process.env[varName]) {
        errors.push(`❌ Missing required ${category} env var: ${varName}`);
      }
    }
  }

  // Validate format
  const port = process.env.PG_PORT;
  if (port && (isNaN(port) || port < 1 || port > 65535)) {
    errors.push('❌ Invalid PG_PORT: must be a number between 1-65535');
  }

  const redisPort = process.env.REDIS_PORT;
  if (redisPort && (isNaN(redisPort) || redisPort < 1 || redisPort > 65535)) {
    errors.push('❌ Invalid REDIS_PORT: must be a number between 1-65535');
  }

  const poolMax = process.env.PG_POOL_MAX;
  if (poolMax && (isNaN(poolMax) || poolMax < 1 || poolMax > 100)) {
    errors.push('❌ Invalid PG_POOL_MAX: must be a number between 1-100');
  }

  // Validate NODE_ENV
  const nodeEnv = process.env.NODE_ENV;
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`❌ Invalid NODE_ENV: must be one of (development, production, test), got: ${nodeEnv}`);
  }

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CLIENT_URL) {
      errors.push('❌ Missing CLIENT_URL env var (required in production for CORS)');
    }
    if (!process.env.ADMIN_EMAIL) {
      errors.push('❌ Missing ADMIN_EMAIL env var (required in production)');
    }
  }

  // Warnings (non-fatal)
  const warnings = [];
  if (process.env.JWT_EXPIRES_IN && !['15m', '30m', '1h', '2h'].includes(process.env.JWT_EXPIRES_IN)) {
    warnings.push(`⚠️ Unusual JWT_EXPIRES_IN: ${process.env.JWT_EXPIRES_IN} (recommended: 15m-1h)`);
  }

  if (errors.length > 0) {
    console.error('\n🚨 ENVIRONMENT CONFIGURATION ERRORS:\n');
    errors.forEach(e => console.error(e));
    console.error('\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  ENVIRONMENT CONFIGURATION WARNINGS:\n');
    warnings.forEach(w => console.warn(w));
    console.warn('\n');
  }

  console.log('✅ Environment validation passed');
};

module.exports = { validateEnv };
