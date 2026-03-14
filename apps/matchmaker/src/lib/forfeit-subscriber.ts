// apps/matchmaker/src/lib/forfeit-subscriber.ts
// Subscribes to the draftchess:forfeit Redis channel.
// The socket server publishes to this channel when a presence grace period
// expires (player disconnected and didn't reconnect within 30s).
// Keeping forfeit logic in the matchmaker means one process owns all
// game-ending paths: timeout, reconcile, and forfeit.

import { createClient }  from 'redis'
import { forfeitGame }   from './forfeit.js'
import type { RedisClientType } from 'redis'

export async function startForfeitSubscriber(
  redisUrl:  string,
  publisher: RedisClientType,
): Promise<void> {
  const client = createClient({ url: redisUrl }) as RedisClientType
  client.on('error', (err) => console.error('[forfeit-sub] redis error:', err))
  await client.connect()

  await client.subscribe('draftchess:forfeit', async (raw) => {
    try {
      const { userId, gameId } = JSON.parse(raw) as { userId: number; gameId: number }
      if (typeof userId !== 'number' || typeof gameId !== 'number') {
        console.error('[forfeit-sub] invalid payload:', raw)
        return
      }
      await forfeitGame(gameId, userId, publisher)
    } catch (err) {
      console.error('[forfeit-sub] error handling message:', err)
    }
  })

  console.log('[forfeit-sub] subscribed to draftchess:forfeit')
}
