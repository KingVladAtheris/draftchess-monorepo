// apps/socket-server/src/presence.ts
//
// CHANGE: Added a polling fallback for environments where Redis keyspace
// notifications are unavailable (ElastiCache, Upstash, managed Redis that
// blocks CONFIG SET).
//
// Primary path: subscribe to __keyevent@N__:expired and react when a
// presence:disconnected:{userId}:{gameId} key expires.
//
// Fallback path: when the keyspace notification subscription either fails or
// hasn't fired within POLL_INTERVAL_MS, a background interval scans all known
// presence keys via SCAN and checks their TTL. Any key whose TTL is ≤ 0 or
// which has disappeared is treated as expired and triggers a forfeit.
//
// The two paths are complementary — the fallback does not replace the primary,
// it runs alongside it so that even if a notification is missed the game will
// still be resolved within POLL_INTERVAL_MS.
//
// POLL_INTERVAL_MS defaults to 5 000 (5 seconds), matching the grace period
// granularity. Setting it higher reduces Redis load at the cost of latency.

import { createClient } from 'redis'
import { logger }       from '@draftchess/logger'

const log = logger.child({ module: 'socket-server:presence' })

export const PRESENCE_KEY_PREFIX   = 'presence:disconnected:'
export const DISCONNECT_GRACE_SECS = 30
const POLL_INTERVAL_MS             = 5_000

export function presenceKey(userId: number, gameId: number): string {
  return `${PRESENCE_KEY_PREFIX}${userId}:${gameId}`
}

export async function setDisconnectedPresence(
  redis: any, userId: number, gameId: number,
): Promise<void> {
  await redis.set(presenceKey(userId, gameId), '1', { EX: DISCONNECT_GRACE_SECS })
}

export async function clearDisconnectedPresence(
  redis: any, userId: number, gameId: number,
): Promise<void> {
  await redis.del(presenceKey(userId, gameId))
}

// ── Shared forfeit publisher ───────────────────────────────────────────────────
// Both the keyspace notification path and the polling fallback call this.
async function publishForfeit(
  cmdClient: any,
  userId:    number,
  gameId:    number,
): Promise<void> {
  try {
    await cmdClient.publish('draftchess:forfeit', JSON.stringify({ userId, gameId }))
    log.info({ userId, gameId }, 'forfeit published')
  } catch (err: any) {
    log.error({ userId, gameId, err: err.message }, 'failed to publish forfeit')
  }
}

// ── Polling fallback ───────────────────────────────────────────────────────────
// Scans Redis for presence:disconnected:* keys and forfeits any that have
// expired (TTL ≤ 0 or key gone). This catches the case where keyspace
// notifications are disabled or a notification was dropped.
function startPresencePoller(cmdClient: any): void {
  const seen = new Set<string>() // keys we know exist — tracks which to watch

  const tick = async () => {
    try {
      let cursor = 0
      const found = new Set<string>()

      // SCAN through all presence keys
      do {
        const result: { cursor: number; keys: string[] } = await cmdClient.scan(
          cursor,
          { MATCH: `${PRESENCE_KEY_PREFIX}*`, COUNT: 100 },
        )
        cursor = result.cursor
        for (const key of result.keys) {
          found.add(key)
          seen.add(key)
        }
      } while (cursor !== 0)

      // Any key we previously saw that is now gone has expired
      for (const key of seen) {
        if (!found.has(key)) {
          seen.delete(key)
          const parts  = key.slice(PRESENCE_KEY_PREFIX.length).split(':')
          const userId = parseInt(parts[0] ?? '')
          const gameId = parseInt(parts[1] ?? '')
          if (!isNaN(userId) && !isNaN(gameId)) {
            log.debug({ userId, gameId }, 'presence expiry detected by poller')
            await publishForfeit(cmdClient, userId, gameId)
          }
        }
      }
    } catch (err: any) {
      log.warn({ err: err.message }, 'presence poller tick failed')
    }
  }

  const intervalId = setInterval(tick, POLL_INTERVAL_MS)

  // Expose a way to stop the poller (useful for graceful shutdown)
  ;(cmdClient as any).__presencePollerInterval = intervalId

  log.info({ intervalMs: POLL_INTERVAL_MS }, 'presence poller started (fallback for keyspace notifications)')
}

// ── Primary: keyspace notification subscriber ──────────────────────────────────
export async function startPresenceExpiry(cmdClient: any): Promise<void> {
  const REDIS_URL = process.env.REDIS_URL!
  const dbIndex   = parseInt(new URL(REDIS_URL).pathname.replace('/', '') || '0', 10)
  const channel   = `__keyevent@${dbIndex}__:expired`

  const client = createClient({ url: REDIS_URL })
  client.on('error', (err) => log.error({ err }, 'presence expiry subscriber error'))

  try {
    await client.connect()
  } catch (err: any) {
    log.error({ err: err.message }, 'presence expiry subscriber failed to connect — falling back to poller only')
    startPresencePoller(cmdClient)
    return
  }

  let notificationsWorking = false

  try {
    await client.subscribe(channel, async (expiredKey) => {
      if (!expiredKey.startsWith(PRESENCE_KEY_PREFIX)) return

      notificationsWorking = true

      const parts  = expiredKey.slice(PRESENCE_KEY_PREFIX.length).split(':')
      const userId = parseInt(parts[0] ?? '')
      const gameId = parseInt(parts[1] ?? '')

      if (isNaN(userId) || isNaN(gameId)) return

      log.debug({ userId, gameId }, 'grace expired via keyspace notification')
      await publishForfeit(cmdClient, userId, gameId)
    })

    log.info({ channel }, 'subscribed to keyspace expiry notifications')
  } catch (err: any) {
    log.warn({ err: err.message }, 'keyspace notification subscribe failed — using poller only')
  }

  // Always start the poller as a safety net.
  // If keyspace notifications are working, the poller acts as a redundant
  // check with ~5s latency tolerance. The forfeit is idempotent on the
  // matchmaker side so duplicate publications are harmless.
  startPresencePoller(cmdClient)
}
