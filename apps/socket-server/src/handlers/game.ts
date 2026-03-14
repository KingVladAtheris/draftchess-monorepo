// apps/socket-server/src/handlers/game.ts
import { prisma }                                               from '@draftchess/db'
import { buildCombinedDraftFen, maskOpponentAuxPlacements }    from '@draftchess/shared/fen-utils'
import { clearDisconnectedPresence }                           from '../presence.js'
import type { Server, Socket }                                 from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@draftchess/socket-types'

type IO     = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
type Sock   = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

const MOVE_TIME_LIMIT = 30_000

export function registerGameHandlers(io: IO, socket: Sock, redis: any): void {
  const { userId } = socket.data

  socket.on('join-game', async (gameId: number) => {
    if (!gameId || typeof gameId !== 'number') return

    try {
      const game = await prisma.game.findUnique({
        where:  { id: gameId },
        select: { player1Id: true, player2Id: true, status: true },
      })

      if (!game) {
        console.warn(`[game] join-game: game ${gameId} not found`)
        return
      }

      if (game.player1Id !== userId && game.player2Id !== userId) {
        console.warn(`[game] join-game: user ${userId} is not a participant in game ${gameId}`)
        return
      }

      socket.join(`game-${gameId}`)
      socket.join(`game-${gameId}-user-${userId}`)
      socket.data.gameId = gameId

      await clearDisconnectedPresence(redis, userId, gameId)

      if (game.status === 'active' || game.status === 'prep') {
        const opponentId = game.player1Id === userId ? game.player2Id : game.player1Id
        io.to(`game-${gameId}-user-${opponentId}`).emit('opponent-connected', { userId })
      }

      await sendSnapshot(socket, gameId, userId)

      console.log(`[game] user ${userId} joined game ${gameId}`)
    } catch (err) {
      console.error(`[game] join-game error`, err)
    }
  })
}

async function sendSnapshot(socket: Sock, gameId: number, userId: number): Promise<void> {
  try {
    const snap = await prisma.game.findUnique({
      where:  { id: gameId },
      select: {
        fen: true, status: true, prepStartedAt: true,
        readyPlayer1: true, readyPlayer2: true,
        auxPointsPlayer1: true, auxPointsPlayer2: true,
        player1Id: true, player2Id: true, whitePlayerId: true,
        draft1: { select: { fen: true } },
        draft2: { select: { fen: true } },
        lastMoveAt: true, moveNumber: true,
        player1Timebank: true, player2Timebank: true,
        winnerId: true, endReason: true,
        player1EloAfter: true, player2EloAfter: true, eloChange: true,
      },
    })

    if (!snap) return

    const isWhite = snap.whitePlayerId === userId
    const rawFen  = snap.fen ?? ''
    let maskedFen = rawFen

    if (snap.status === 'prep') {
      if (snap.draft1?.fen && snap.draft2?.fen) {
        const originalFen = buildCombinedDraftFen(snap.draft1.fen, snap.draft2.fen)
        maskedFen = maskOpponentAuxPlacements(rawFen, originalFen, isWhite)
      } else {
        console.warn(`[game] snapshot: draft FEN missing during prep for game ${gameId}`)
      }
    }

    let timeRemainingOnMove = MOVE_TIME_LIMIT
    if (snap.status === 'active' && snap.lastMoveAt) {
      const turn    = rawFen.split(' ')[1]
      const myTurn  = (turn === 'w' && isWhite) || (turn === 'b' && !isWhite)
      const elapsed = Date.now() - new Date(snap.lastMoveAt).getTime()
      if (myTurn) timeRemainingOnMove = Math.max(0, MOVE_TIME_LIMIT - elapsed)
    }

    socket.emit('game-snapshot', {
      fen:              maskedFen,
      status:           snap.status as 'prep' | 'active' | 'finished',
      prepStartedAt:    snap.prepStartedAt?.toISOString() ?? null,
      readyPlayer1:     snap.readyPlayer1,
      readyPlayer2:     snap.readyPlayer2,
      auxPointsPlayer1: snap.auxPointsPlayer1,
      auxPointsPlayer2: snap.auxPointsPlayer2,
      moveNumber:       snap.moveNumber,
      player1Timebank:  snap.player1Timebank,
      player2Timebank:  snap.player2Timebank,
      lastMoveAt:       snap.lastMoveAt?.toISOString() ?? null,
      timeRemainingOnMove,
      winnerId:         snap.winnerId ?? null,
      endReason:        snap.endReason ?? undefined,
      player1EloAfter:  snap.player1EloAfter ?? undefined,
      player2EloAfter:  snap.player2EloAfter ?? undefined,
      eloChange:        snap.eloChange ?? undefined,
      // Extra fields required by GameSnapshotPayload
      player1Id:        snap.player1Id,
      player2Id:        snap.player2Id,
      isWhite,
    })
  } catch (err) {
    console.error(`[game] snapshot error for game ${gameId}`, err)
  }
}