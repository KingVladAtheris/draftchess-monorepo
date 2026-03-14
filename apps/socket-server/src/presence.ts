// apps/socket-server/src/presence.ts
import { createClient } from 'redis'

export const PRESENCE_KEY_PREFIX   = 'presence:disconnected:'
export const DISCONNECT_GRACE_SECS = 30

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

export async function startPresenceExpiry(cmdClient: any): Promise<void> {
  const REDIS_URL  = process.env.REDIS_URL!
  const dbIndex    = parseInt(new URL(REDIS_URL).pathname.replace('/', '') || '0', 10)
  const channel    = `__keyevent@${dbIndex}__:expired`

  const client = createClient({ url: REDIS_URL })
  client.on('error', err => console.error('[presence]', err))
  await client.connect()

  await client.subscribe(channel, async (expiredKey) => {
    if (!expiredKey.startsWith(PRESENCE_KEY_PREFIX)) return
    const parts  = expiredKey.slice(PRESENCE_KEY_PREFIX.length).split(':')
    const userId = parseInt(parts[0] ?? '')
    const gameId = parseInt(parts[1] ?? '')
    if (isNaN(userId) || isNaN(gameId)) return
    console.log(`[presence] grace expired userId=${userId} gameId=${gameId}`)
    // Publish to the forfeit channel — matchmaker subscribes and handles it
    await cmdClient.publish('draftchess:forfeit', JSON.stringify({ userId, gameId }))
  })

  console.log(`[presence] subscribed to ${channel}`)
}