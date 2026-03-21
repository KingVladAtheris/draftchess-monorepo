// apps/web/src/app/lib/rate-limit.ts
//
// CHANGE: Added challengeLimiter — 5 challenges per user per hour.
// Prevents spam-challenging after a decline (previously unlimited).

import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import Redis from 'ioredis'
import { NextRequest, NextResponse } from 'next/server'

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

let _redisClient: Redis | null = null

function getRedisClient(): Redis {
  if (!_redisClient) {
    const opts = parseRedisUrl(process.env.REDIS_URL!)
    _redisClient = new Redis(opts)
    _redisClient.on('error', (err) => console.error('[RateLimit] Redis error:', err))
  }
  return _redisClient
}

const _memoryAuthLimiter = new RateLimiterMemory({
  points:    3,
  duration:  15 * 60,
  keyPrefix: 'mem:auth',
})

export const signupLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:signup',
  points:      5,
  duration:    15 * 60,
})

export const loginLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:login',
  points:      10,
  duration:    15 * 60,
})

export const queueLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:queue',
  points:      10,
  duration:    60,
})

export const moveLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:move',
  points:      60,
  duration:    60,
})

export const placeLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:place',
  points:      20,
  duration:    60,
})

export const draftLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:draft',
  points:      30,
  duration:    60,
})

export const generalLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:general',
  points:      120,
  duration:    60,
})

// 5 challenges sent per user per hour — prevents spam-challenging after declines.
// Keyed by userId so it's per-sender, not per-IP.
export const challengeLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:challenge',
  points:      5,
  duration:    60 * 60,
})

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

    console.error('[RateLimit] consume error:', err)

    if (!isAuthRoute) return null

    try {
      await _memoryAuthLimiter.consume(limitKey)
      console.warn('[RateLimit] auth route using memory fallback for key:', limitKey)
      return null
    } catch (memErr) {
      if (memErr instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(memErr.msBeforeNext / 1000)
        return NextResponse.json(
          { error: 'Too many requests', retryAfter },
          { status: 429, headers: { 'Retry-After': retryAfter.toString() } },
        )
      }
      console.error('[RateLimit] memory fallback error:', memErr)
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
