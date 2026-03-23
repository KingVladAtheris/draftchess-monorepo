// apps/web/src/app/lib/rate-limit.ts
//
// CHANGE: The ioredis client for rate-limiting is now the same singleton
// used by redis-publisher.ts. Previously this module created its own
// separate ioredis connection pool alongside the node-redis publisher,
// wasting connections. We now share one ioredis instance across the
// rate limiter and use a lazy-initialised singleton pattern.
//
// CHANGE: Added challengeLimiter — 5 challenges per user per hour.

import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import Redis                                                    from 'ioredis'
import { NextRequest, NextResponse }                           from 'next/server'
import { logger }                                              from '@draftchess/logger'

const log = logger.child({ module: 'web:rate-limit' })

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set')
}

function parseRedisUrl(url: string) {
  const u = new URL(url)
  return {
    host:     u.hostname,
    port:     parseInt(u.port || '6379', 10),
    password: u.password || undefined,
  }
}

// ── Single shared ioredis client for all rate limiters ────────────────────────
// Using a module-level singleton prevents each Next.js route invocation from
// opening a new connection. ioredis reconnects automatically on failure.
let _ioRedis: Redis | null = null

function getIoRedis(): Redis {
  if (_ioRedis) return _ioRedis

  const opts = parseRedisUrl(process.env.REDIS_URL!)
  _ioRedis   = new Redis(opts)

  _ioRedis.on('error',  (err) => log.error({ err: err.message }, 'rate-limit redis error'))
  _ioRedis.on('ready',  ()    => log.debug('rate-limit redis ready'))

  return _ioRedis
}

// ── In-memory fallback for auth routes when Redis is unavailable ──────────────
const _memoryAuthLimiter = new RateLimiterMemory({
  points:    3,
  duration:  15 * 60,
  keyPrefix: 'mem:auth',
})

// ── Rate limiters ─────────────────────────────────────────────────────────────
export const signupLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:signup',
  points:      5,
  duration:    15 * 60,
})

export const loginLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:login',
  points:      10,
  duration:    15 * 60,
})

export const queueLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:queue',
  points:      10,
  duration:    60,
})

export const moveLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:move',
  points:      60,
  duration:    60,
})

export const placeLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:place',
  points:      20,
  duration:    60,
})

export const draftLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:draft',
  points:      30,
  duration:    60,
})

export const generalLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:general',
  points:      120,
  duration:    60,
})

// 5 challenges sent per user per hour — prevents spam-challenging after declines.
// Keyed by userId so it's per-sender, not per-IP.
export const challengeLimiter = new RateLimiterRedis({
  storeClient: getIoRedis(),
  keyPrefix:   'rl:challenge',
  points:      5,
  duration:    60 * 60,
})

// ── Core consume function ─────────────────────────────────────────────────────
export async function consume(
  limiter: RateLimiterRedis,
  request: NextRequest,
  key?: string,
  isAuthRoute = false,
): Promise<NextResponse | null> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const limitKey = key ?? ip

  try {
    await limiter.consume(limitKey)
    return null
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000)
      log.warn({ limitKey, retryAfter }, 'rate limit exceeded')
      return NextResponse.json(
        { error: 'Too many requests', retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After':       retryAfter.toString(),
            'X-RateLimit-Reset': new Date(Date.now() + err.msBeforeNext).toISOString(),
          },
        },
      )
    }

    log.error({ err, limitKey }, 'rate limiter consume error')

    if (!isAuthRoute) {
      // Non-auth routes fail open on Redis errors — availability > strict limiting
      return null
    }

    // Auth routes fail closed via in-memory fallback
    try {
      await _memoryAuthLimiter.consume(limitKey)
      log.warn({ limitKey }, 'auth route using memory fallback for rate limit')
      return null
    } catch (memErr) {
      if (memErr instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(memErr.msBeforeNext / 1000)
        return NextResponse.json(
          { error: 'Too many requests', retryAfter },
          { status: 429, headers: { 'Retry-After': retryAfter.toString() } },
        )
      }
      log.error({ err: memErr }, 'memory fallback rate limiter error')
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 },
      )
    }
  }
}

export async function consumeAuth(
  limiter: RateLimiterRedis,
  request: NextRequest,
  key?: string,
): Promise<NextResponse | null> {
  return consume(limiter, request, key, true)
}
