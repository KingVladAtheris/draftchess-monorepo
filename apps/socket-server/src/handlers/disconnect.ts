// apps/socket-server/src/handlers/disconnect.ts
import { prisma }                   from '@draftchess/db'
import { setDisconnectedPresence }  from '../presence.js'
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

    // Remove online presence immediately
    redis.del(`online:${userId}`).catch(() => {})

    try {
      const user = await prisma.user.findUnique({
        where:  { id: userId },
        select: { queueStatus: true },
      })

      if (!user) return

      // If the user was in the matchmaking queue, remove them cleanly.
      // No grace period needed — they weren't in a game.
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

      // Not in a game — nothing else to do
      if (user.queueStatus !== 'in_game') return

      // Try the gameId we stored on the socket first (fastest path)
      const knownGameId = socket.data.gameId

      if (!knownGameId) {
        // Fallback: look up the active game from the DB.
        // This happens if the client connected but never emitted join-game.
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

      if (!game || (game.status !== 'active' && game.status !== 'prep')) return

      const opponentId = game.player1Id === userId ? game.player2Id : game.player1Id
      await setDisconnectedPresence(redis, userId, knownGameId)
      io.to(`game-${knownGameId}-user-${opponentId}`).emit('opponent-disconnected', {
        userId,
        gracePeriodSecs: DISCONNECT_GRACE_SECS,
      })

    } catch (err) {
      console.error(`[disconnect] error for user ${userId}`, err)
    }
  })
}