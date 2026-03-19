// apps/matchmaker/src/lib/forfeit-subscriber.ts
//
// Subscribes to the draftchess:forfeit Redis channel.
// The socket server publishes to this channel when a presence grace period
// expires (player disconnected and didn't reconnect within 30s).
// Keeping forfeit logic in the matchmaker means one process owns all
// game-ending paths: timeout, reconcile, forfeit, and game-ended.

import { createClient }  from 'redis'
import { forfeitGame }   from './forfeit.js'
import { logger }        from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:forfeit-subscriber' })

export async function startForfeitSubscriber(
  redisUrl:  string,
  publisher: RedisClientType,
): Promise<void> {
  const client = createClient({ url: redisUrl }) as RedisClientType
  client.on('error', (err) => log.error({ err }, 'forfeit subscriber redis error'))
  await client.connect()

  await client.subscribe('draftchess:forfeit', async (raw) => {
    let userId: number
    let gameId: number

    try {
      const parsed = JSON.parse(raw) as { userId: number; gameId: number }
      userId = parsed.userId
      gameId = parsed.gameId
    } catch (err) {
      log.error({ raw, err }, 'failed to parse forfeit message')
      return
    }

    if (typeof userId !== 'number' || typeof gameId !== 'number') {
      log.error({ raw }, 'invalid forfeit payload — missing userId or gameId')
      return
    }

    try {
      await forfeitGame(gameId, userId, publisher)
    } catch (err) {
      log.error({ gameId, userId, err }, 'error processing forfeit')
    }
  })

  log.info('subscribed to draftchess:forfeit')
}