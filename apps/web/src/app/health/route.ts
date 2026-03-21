// apps/web/src/app/health/route.ts
//
// CHANGE: Redis client is now obtained via the shared singleton from
// redis-publisher.ts rather than creating a new one per module instance.
// The previous implementation created a new Redis connection per cold start
// (common in multi-worker Next.js deployments), silently exhausting the
// connection pool. The shared publisher singleton handles reconnection.

import { NextResponse }   from 'next/server'
import { prisma }         from '@draftchess/db'
import { getRedisClient } from '@/app/lib/redis-publisher'

export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {}
  let healthy = true

  // ── Postgres ────────────────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.postgres = 'ok'
  } catch {
    checks.postgres = 'error'
    healthy = false
  }

  // ── Redis ───────────────────────────────────────────────────────────────────
  try {
    const redis = await getRedisClient()
    await redis.ping()
    checks.redis = 'ok'
  } catch {
    checks.redis = 'error'
    healthy = false
  }

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 },
  )
}
