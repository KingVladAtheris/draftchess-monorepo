// apps/matchmaker/src/lib/game-started-subscriber.ts
//
// Subscribes to the draftchess:game-started Redis channel.
//
// The web app's ready route publishes to this channel when both players
// are ready and the game transitions from prep to active.
// The matchmaker schedules the initial timeout job here, taking ownership
// of all timeout scheduling away from the web app entirely.
//
// This means apps/web/src/app/lib/queues.ts can be deleted — the web app
// no longer needs any BullMQ queue access.
//
// Message shape:
// {
//   gameId:          number
//   player1Id:       number
//   whitePlayerId:   number
//   player1Timebank: number
//   player2Timebank: number
//   lastMoveAt:      string   // ISO timestamp
//   fenTurn:         string   // 'w' or 'b'
// }

import { createClient }     from 'redis'
import { scheduleTimeout }  from '../queues.js'
import { logger }           from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:game-started-subscriber' })

export interface GameStartedPayload {
  gameId:          number
  player1Id:       number
  whitePlayerId:   number
  player1Timebank: number
  player2Timebank: number
  lastMoveAt:      string
  fenTurn:         string
}

export async function startGameStartedSubscriber(
  redisUrl: string,
): Promise<void> {
  const client = createClient({ url: redisUrl }) as RedisClientType
  client.on('error', (err) => log.error({ err }, 'game-started subscriber redis error'))
  await client.connect()

  await client.subscribe('draftchess:game-started', async (raw) => {
    let payload: GameStartedPayload

    try {
      payload = JSON.parse(raw) as GameStartedPayload
    } catch (err) {
      log.error({ raw, err }, 'failed to parse game-started message')
      return
    }

    const {
      gameId,
      player1Id,
      whitePlayerId,
      player1Timebank,
      player2Timebank,
      lastMoveAt,
      fenTurn,
    } = payload

    if (typeof gameId !== 'number' || typeof player1Id !== 'number') {
      log.error({ payload }, 'invalid game-started payload')
      return
    }

    const whiteIsP1 = whitePlayerId === player1Id

    try {
      await scheduleTimeout(
        gameId,
        player1Timebank,
        player2Timebank,
        lastMoveAt,
        fenTurn ?? 'w',
        whiteIsP1,
      )
      log.info({ gameId, fenTurn, whiteIsP1 }, 'scheduled initial timeout')
    } catch (err: any) {
      log.error({ gameId, err: err.message }, 'failed to schedule initial timeout')
    }
  })

  log.info('subscribed to draftchess:game-started')
}
