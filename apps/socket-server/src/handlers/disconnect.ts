// apps/socket-server/src/handlers/disconnect.ts
//
// CHANGE: On disconnect from a finished game, cancel any pending rematch
// offer. "Offer expires immediately on navigation" is implemented here —
// when the socket disconnects from the game room, the offer is cleared
// and the opponent is notified so they don't wait for a 30s expiry.

import { prisma }                   from '@draftchess/db'
import { setDisconnectedPresence }  from '../presence.js'
import {
  getGameState,
  cancelRematch,
} from '@draftchess/game-state'
import type { Server, Socket }      from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@draftchess/socket-types'

type IO   = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

const DISCONNECT_GRACE_SECS = 30

export function registerDisconnect(io: IO, socket: Sock, redis: any): void {
  socket.on('disconnect', async (reason) => {
    const { userId } = socket.data
    console.log(`[disconnect] user ${userId} disconnected — reason: ${reason}`)

    redis.del(`online:${userId}`).catch(() => {})

    try {
      const user = await prisma.user.findUnique({
        where:  { id: userId },
        select: { queueStatus: true },
      })

      if (!user) return

      if (user.queueStatus === 'queued') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            queueStatus:   'offline',
            queuedAt:      null,
            queuedDraftId: null,
          },
        })
        console.log(`[disconnect] user ${userId} removed from queue`)
        return
      }

      if (user.queueStatus !== 'in_game') {
        // User may be on a finished game page with a pending rematch offer.
        // Check their known gameId for a rematch offer to cancel.
        const knownGameId = socket.data.gameId
        if (knownGameId) {
          await maybeCancelRematch(io, redis, userId, knownGameId)
        }
        return
      }

      const knownGameId = socket.data.gameId

      if (!knownGameId) {
        const game = await prisma.game.findFirst({
          where: {
            status: { in: ['active', 'prep'] },
            OR:     [{ player1Id: userId }, { player2Id: userId }],
          },
          select: { id: true, player1Id: true, player2Id: true },
        })

        if (!game) return

        const opponentId = game.player1Id === userId ? game.player2Id : game.player1Id
        await setDisconnectedPresence(redis, userId, game.id)
        io.to(`game-${game.id}-user-${opponentId}`).emit('opponent-disconnected', {
          userId,
          gracePeriodSecs: DISCONNECT_GRACE_SECS,
        })
        return
      }

      const game = await prisma.game.findUnique({
        where:  { id: knownGameId },
        select: { id: true, status: true, player1Id: true, player2Id: true },
      })

      if (!game) return

      if (game.status === 'active' || game.status === 'prep') {
        const opponentId = game.player1Id === userId ? game.player2Id : game.player1Id
        await setDisconnectedPresence(redis, userId, knownGameId)
        io.to(`game-${knownGameId}-user-${opponentId}`).emit('opponent-disconnected', {
          userId,
          gracePeriodSecs: DISCONNECT_GRACE_SECS,
        })
        return
      }

      // Game is finished — check for pending rematch offer to cancel
      if (game.status === 'finished') {
        await maybeCancelRematch(io, redis, userId, knownGameId)
      }

    } catch (err) {
      console.error(`[disconnect] error for user ${userId}`, err)
    }
  })
}

/**
 * If the disconnecting user has a pending rematch offer on this game,
 * cancel it and notify the opponent so they don't wait 30 seconds.
 */
async function maybeCancelRematch(
  io:     IO,
  redis:  any,
  userId: number,
  gameId: number,
): Promise<void> {
  try {
    const state = await getGameState(redis, gameId)
    if (!state || state.rematchRequestedBy !== userId) return

    await cancelRematch(redis, gameId)

    // Notify opponent
    const opponentId = state.player1Id === userId ? state.player2Id : state.player1Id
    io.to(`game-${gameId}-user-${opponentId}`).emit('game-update' as any, {
      rematchCancelled: true,
    })

    console.log(`[disconnect] cancelled rematch offer for gameId=${gameId} userId=${userId}`)
  } catch (err) {
    console.error(`[disconnect] failed to cancel rematch for gameId=${gameId}`, err)
  }
}
