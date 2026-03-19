// apps/web/src/app/lib/env.ts
// Validates required environment variables at process start.
// Import this at the top of server.ts and any long-running entry point.
// Throws immediately with a clear message rather than failing mid-request.
//
// Usage:
//   import '@/app/lib/env';  // side-effect import — validation runs on load

const REQUIRED: Record<string, string> = {
  DATABASE_URL:          'PostgreSQL connection string',
  REDIS_URL:             'Redis connection string',
  AUTH_SECRET:           'NextAuth secret (openssl rand -base64 32)',
  AUTH_URL:          'Public app URL e.g. https://yourdomain.com',
};

// Optional but warn if missing
const RECOMMENDED: Record<string, string> = {
  APP_URL:   'Public app URL for CORS (defaults to NEXTAUTH_URL)',
  HEALTH_PORT:           'Port for matchmaker health endpoint (default 3001)',
};

const missing  = Object.keys(REQUIRED).filter(k => !process.env[k]);
const warnings = Object.keys(RECOMMENDED).filter(k => !process.env[k]);

if (missing.length > 0) {
  console.error('\n[env] ✖ Missing required environment variables:\n');
  for (const key of missing) {
    console.error(`  ${key.padEnd(24)} — ${REQUIRED[key]}`);
  }
  console.error('\nFix these before starting the server.\n');
  process.exit(1);
}

if (warnings.length > 0) {
  for (const key of warnings) {
    console.warn(`[env] ⚠ ${key} not set — ${RECOMMENDED[key]}`);
  }
}
