// apps/socket-server/src/subscriber.ts
//
// CHANGE: Added handling for msg.type === 'notification'.
// The matchmaker and web app publish to draftchess:notifications with
// type: 'notification'. The subscriber now forwards these to the
// recipient's queue-user-{userId} room as a 'notification' socket event.

import { createClient }              from 'redis'
import { getGameState }              from '@draftchess/game-state'
import { buildCombinedDraftFen, maskOpponentAuxPlacements } from '@draftchess/shared/fen-utils'
import type { Server }               from 'socket.io'
import type { RedisMessage }         from '@draftchess/socket-types'

const GAME_EVENTS_CHANNEL    = 'draftchess:game-events'
const NOTIFICATIONS_CHANNEL  = 'draftchess:notifications'

export async function subscribeToRedis(io: Server, cmdClient: any): Promise<void> {
  // Game events subscriber
  const gameClient = createClient({ url: process.env.REDIS_URL })
  gameClient.on('error', err => console.error('[subscriber:game]', err))
  await gameClient.connect()

  await gameClient.subscribe(GAME_EVENTS_CHANNEL, async (raw) => {
    try {
      const msg = JSON.parse(raw) as RedisMessage

      if (msg.type === 'game') {
        const { gameId, event, payload } = msg

        if (event === 'game-update' && payload['fen'] && !payload['status']) {
          const state = await getGameState(cmdClient, gameId)

          if (
            state &&
            state.status === 'prep' &&
            state.draft1Fen &&
            state.draft2Fen
          ) {
            const fen         = payload['fen'] as string
            const originalFen = buildCombinedDraftFen(state.draft1Fen, state.draft2Fen)
            const p1IsWhite   = state.whitePlayerId === state.player1Id

            io.to(`game-${gameId}-user-${state.player1Id}`).emit(event, {
              ...payload,
              fen: maskOpponentAuxPlacements(fen, originalFen, p1IsWhite),
            })
            io.to(`game-${gameId}-user-${state.player2Id}`).emit(event, {
              ...payload,
              fen: maskOpponentAuxPlacements(fen, originalFen, !p1IsWhite),
            })
            return
          }
        }

        io.to(`game-${gameId}`).emit(event, payload)

      } else if (msg.type === 'queue-user') {
        io.to(`queue-user-${msg.userId}`).emit(msg.event as any, msg.payload)
      }
    } catch (err) {
      console.error('[subscriber:game] error handling message', err)
    }
  })

  // Notifications subscriber — separate client because a subscribed
  // Redis connection cannot issue regular commands.
  const notifClient = createClient({ url: process.env.REDIS_URL })
  notifClient.on('error', err => console.error('[subscriber:notifications]', err))
  await notifClient.connect()

  await notifClient.subscribe(NOTIFICATIONS_CHANNEL, (raw) => {
    try {
      const msg = JSON.parse(raw)

      // Shape: { type: 'notification', userId, notificationType, payload }
      if (msg.type === 'notification' && typeof msg.userId === 'number') {
        io.to(`queue-user-${msg.userId}`).emit('notification', {
          notificationId:   msg.payload?.notificationId,
          notificationType: msg.notificationType,
          payload:          msg.payload,
        })
      }
    } catch (err) {
      console.error('[subscriber:notifications] error handling message', err)
    }
  })

  console.log('[subscriber] subscribed to game-events and notifications channels')
}
