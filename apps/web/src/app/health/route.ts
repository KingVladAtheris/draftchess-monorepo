// apps/web/src/app/health/route.ts
// Lightweight liveness + readiness probe for load balancers and orchestrators.
// Returns 200 when the process is alive and both Postgres and Redis are reachable.
// Returns 503 with a JSON body explaining which dependency failed.
//
// Intentionally has no auth — orchestrators call this without credentials.
// No sensitive data is exposed: only "ok" | "error" per dependency.

import { NextResponse } from 'next/server';
import { prisma } from '@draftchess/db';
import { createClient } from 'redis';

// Reuse a single Redis client for health checks to avoid connection churn.
// It is created lazily on first request and kept alive.
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', () => {
      // Reset so the next request creates a fresh client
      redisClient = null;
    });
    await redisClient.connect();
  }
  return redisClient;
}

export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {};
  let healthy = true;

  // ── Postgres ────────────────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'error';
    healthy = false;
  }

  // ── Redis ───────────────────────────────────────────────────────────────────
  try {
    const redis = await getRedisClient();
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    healthy = false;
    redisClient = null; // force reconnect next time
  }

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 }
  );
}
