// apps/matchmaker/src/lib/queue-join-subscriber.ts
//
// Subscribes to the draftchess:queue-join Redis channel.
// The web app publishes to this channel when a player joins the matchmaking
// queue. We respond by adding a try-match job to BullMQ so the match worker
// wakes up immediately rather than waiting for its next poll cycle.
//
// This replaces the web app's queue-join.ts which previously accessed BullMQ
// directly. The web app now has zero BullMQ dependency.

import { createClient }  from 'redis'
import { matchQueue }    from '../queues.js'
import { logger }        from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:queue-join-subscriber' })

export async function startQueueJoinSubscriber(
  redisUrl: string,
): Promise<void> {
  const client = createClient({ url: redisUrl }) as RedisClientType
  client.on('error', (err) => log.error({ err }, 'queue-join subscriber redis error'))
  await client.connect()

  await client.subscribe('draftchess:queue-join', async (_raw) => {
    try {
      // Add with a short delay so the Postgres write has committed
      // before the match worker reads the queued players list.
      await matchQueue.add('try-match', {}, { delay: 200 })
      log.debug('try-match job added from queue-join event')
    } catch (err: any) {
      // Non-fatal — the matchmaker will still find the player on its next cycle
      log.warn({ err: err.message }, 'failed to add try-match job from queue-join event')
    }
  })

  log.info('subscribed to draftchess:queue-join')
}