// apps/socket-server/src/subscriber.ts
//
// CHANGE: Draft FENs for prep-phase masking are now read from the Redis
// game hash (draft1Fen / draft2Fen fields) instead of issuing a Postgres
// query on every move broadcast. Those fields are immutable after game
// creation and are always present in the hash — no DB round-trip needed.

import { createClient }              from 'redis'
import { getGameState }              from '@draftchess/game-state'
import { buildCombinedDraftFen, maskOpponentAuxPlacements } from '@draftchess/shared/fen-utils'
import type { Server }               from 'socket.io'
import type { RedisMessage }         from '@draftchess/socket-types'

const GAME_EVENTS_CHANNEL = 'draftchess:game-events'

export async function subscribeToRedis(io: Server, cmdClient: any): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL })
  client.on('error', err => console.error('[subscriber]', err))
  await client.connect()

  await client.subscribe(GAME_EVENTS_CHANNEL, async (raw) => {
    try {
      const msg = JSON.parse(raw) as RedisMessage

      if (msg.type === 'game') {
        const { gameId, event, payload } = msg

        // Prep-phase FEN masking: read draft FENs from Redis hash.
        // The hash fields draft1Fen / draft2Fen are seeded at game creation
        // and never mutated — always available without a Postgres query.
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
      console.error('[subscriber] error handling message', err)
    }
  })
}
