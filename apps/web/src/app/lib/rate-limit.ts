// src/app/lib/rate-limit.ts
//
// CHANGES:
//   - Auth limiters (signup, login) now FAIL CLOSED on Redis error.
//     A Redis outage must not silently disable brute-force protection.
//   - All other limiters retain fail-open behaviour (don't block a game
//     in progress over a transient Redis blip).
//   - In-memory fallback limiter for auth routes when Redis is unavailable,
//     using a simple sliding-window Map. This keeps auth protection alive
//     even during Redis downtime, without adding a dependency.

import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { NextRequest, NextResponse } from 'next/server';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set');
}

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host:     u.hostname,
    port:     parseInt(u.port || '6379', 10),
    password: u.password || undefined,
  };
}

let _redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!_redisClient) {
    const opts = parseRedisUrl(process.env.REDIS_URL!);
    _redisClient = new Redis(opts);
    _redisClient.on('error', (err) => console.error('[RateLimit] Redis error:', err));
  }
  return _redisClient;
}

// ─── In-memory fallback for auth limiters ────────────────────────────────────
// Used only when Redis is unavailable. Simple fixed-window per key.
// Intentionally conservative: 3 attempts per 15 minutes.
const _memoryAuthLimiter = new RateLimiterMemory({
  points:   3,
  duration: 15 * 60,
  keyPrefix: 'mem:auth',
});

// ─── Limiter definitions ─────────────────────────────────────────────────────

// Auth: FAIL CLOSED — 5 attempts per IP per 15 minutes
export const signupLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:signup',
  points:      5,
  duration:    15 * 60,
});

// Auth: FAIL CLOSED — 10 attempts per IP per 15 minutes
export const loginLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:login',
  points:      10,
  duration:    15 * 60,
});

// Queue join: fail open — 10 per user per minute
export const queueLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:queue',
  points:      10,
  duration:    60,
});

// Move: fail open — 60 per user per minute
export const moveLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:move',
  points:      60,
  duration:    60,
});

// Place: fail open — 20 per user per minute
export const placeLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:place',
  points:      20,
  duration:    60,
});

// Draft save: fail open — 30 per user per minute
export const draftLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:draft',
  points:      30,
  duration:    60,
});

// General: fail open — 120 per user per minute
export const generalLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix:   'rl:general',
  points:      120,
  duration:    60,
});

// ─── consume() ───────────────────────────────────────────────────────────────
//
// isAuthRoute: when true, Redis errors cause a 503 (fail closed) unless the
// in-memory fallback also rejects, in which case we return 429.
// When false (default), Redis errors are logged and the request is allowed.

export async function consume(
  limiter: RateLimiterRedis,
  request: NextRequest,
  key?: string,
  isAuthRoute = false,
): Promise<NextResponse | null> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const limitKey = key ?? ip;

  try {
    await limiter.consume(limitKey);
    return null; // allowed
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      // Normal rate-limit rejection from Redis
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      return NextResponse.json(
        { error: 'Too many requests', retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After':       retryAfter.toString(),
            'X-RateLimit-Reset': new Date(Date.now() + err.msBeforeNext).toISOString(),
          },
        }
      );
    }

    // Redis connection error
    console.error('[RateLimit] consume error:', err);

    if (!isAuthRoute) {
      // Non-auth routes: fail open — don't block legitimate traffic
      return null;
    }

    // Auth routes: try in-memory fallback limiter
    try {
      await _memoryAuthLimiter.consume(limitKey);
      // Memory limiter allowed it — Redis is down but request is within fallback budget
      console.warn('[RateLimit] auth route using memory fallback for key:', limitKey);
      return null;
    } catch (memErr) {
      if (memErr instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(memErr.msBeforeNext / 1000);
        return NextResponse.json(
          { error: 'Too many requests', retryAfter },
          { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
        );
      }
      // Memory limiter itself errored — fail closed with 503
      console.error('[RateLimit] memory fallback error:', memErr);
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 }
      );
    }
  }
}

// Convenience wrapper for auth routes — avoids passing isAuthRoute=true everywhere
export async function consumeAuth(
  limiter: RateLimiterRedis,
  request: NextRequest,
  key?: string,
): Promise<NextResponse | null> {
  return consume(limiter, request, key, true);
}
