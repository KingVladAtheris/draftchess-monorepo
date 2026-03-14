// apps/socket-server/src/subscriber.ts
import { createClient }              from 'redis'
import { prisma }                    from '@draftchess/db'
import { buildCombinedDraftFen, maskOpponentAuxPlacements } from '@draftchess/shared/fen-utils'
import type { Server }               from 'socket.io'
import type { RedisMessage }         from '@draftchess/socket-types'

const GAME_EVENTS_CHANNEL = 'draftchess:game-events'

export async function subscribeToRedis(io: Server, _cmdClient: any): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL })
  client.on('error', err => console.error('[subscriber]', err))
  await client.connect()

  await client.subscribe(GAME_EVENTS_CHANNEL, async (raw) => {
    try {
      const msg = JSON.parse(raw) as RedisMessage

      if (msg.type === 'game') {
        const { gameId, event, payload } = msg

        if (event === 'game-update' && payload['fen'] && !payload['status']) {
          const game = await prisma.game.findUnique({
            where:  { id: gameId },
            select: {
              status:        true,
              player1Id:     true,
              player2Id:     true,
              whitePlayerId: true,
              draft1: { select: { fen: true } },
              draft2: { select: { fen: true } },
            },
          })

          if (game?.status === 'prep' && game.draft1?.fen && game.draft2?.fen) {
            const fen         = payload['fen'] as string
            const originalFen = buildCombinedDraftFen(game.draft1.fen, game.draft2.fen)
            const p1IsWhite   = game.whitePlayerId === game.player1Id
            io.to(`game-${gameId}-user-${game.player1Id}`).emit(event, {
              ...payload, fen: maskOpponentAuxPlacements(fen, originalFen, p1IsWhite),
            })
            io.to(`game-${gameId}-user-${game.player2Id}`).emit(event, {
              ...payload, fen: maskOpponentAuxPlacements(fen, originalFen, !p1IsWhite),
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