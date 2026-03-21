// apps/socket-server/src/handlers/game.ts
//
// FIX: loadGameState was called 3 times per join-game on finished games:
//   1. Initial load for participant check
//   2. sendSnapshot calling loadGameState again
//   3. sendFinishedSnapshot hitting Postgres
// Now the state is loaded once and threaded through to sendSnapshot,
// eliminating the repeated Postgres fallback calls on finished games.

import { prisma }                                            from '@draftchess/db'
import { loadGameState }                                     from '@draftchess/game-state'
import { buildCombinedDraftFen, maskOpponentAuxPlacements } from '@draftchess/shared/fen-utils'
import { clearDisconnectedPresence }                        from '../presence.js'
import { logger }                                           from '@draftchess/logger'
import type { Server, Socket }                              from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@draftchess/socket-types'

type IO   = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

const log = logger.child({ module: 'socket-server:game' })

const MOVE_TIME_LIMIT = 30_000

export function registerGameHandlers(io: IO, socket: Sock, redis: any): void {
  const { userId } = socket.data

  socket.on('join-game', async (gameId: number) => {
    if (!gameId || typeof gameId !== 'number') return

    try {
      // Load state once — reuse for participant check, room join, and snapshot.
      const state = await loadGameState(redis, gameId)

      if (!state) {
        log.warn({ gameId, userId }, 'join-game: game not found')
        return
      }

      // ── Participant check ──────────────────────────────────────────────────
      let player1Id: number
      let player2Id: number
      let gameStatus: string

      if (state === 'finished') {
        // Hash deleted — must check Postgres for player IDs
        const pg = await prisma.game.findUnique({
          where:  { id: gameId },
          select: { player1Id: true, player2Id: true, status: true },
        })
        if (!pg) {
          log.warn({ gameId, userId }, 'join-game: finished game not found in Postgres')
          return
        }
        player1Id  = pg.player1Id
        player2Id  = pg.player2Id
        gameStatus = pg.status
      } else {
        player1Id  = state.player1Id
        player2Id  = state.player2Id
        gameStatus = state.status
      }

      if (player1Id !== userId && player2Id !== userId) {
        log.warn({ gameId, userId }, 'join-game: user is not a participant')
        return
      }

      socket.join(`game-${gameId}`)
      socket.join(`game-${gameId}-user-${userId}`)
      socket.data.gameId = gameId

      await clearDisconnectedPresence(redis, userId, gameId)

      if (gameStatus === 'active' || gameStatus === 'prep') {
        const opponentId = player1Id === userId ? player2Id : player1Id
        io.to(`game-${gameId}-user-${opponentId}`).emit('opponent-connected', { userId })
      }

      // Pass the already-loaded state through so sendSnapshot doesn't reload it
      await sendSnapshot(socket, redis, gameId, userId, state)

      log.info({ gameId, userId }, 'user joined game')

    } catch (err) {
      log.error({ gameId, userId, err }, 'join-game error')
    }
  })
}

async function sendSnapshot(
  socket: Sock,
  redis:  any,
  gameId: number,
  userId: number,
  // Accept the already-loaded state so we don't call loadGameState again
  state: Awaited<ReturnType<typeof loadGameState>>,
): Promise<void> {
  try {
    if (!state) {
      log.warn({ gameId, userId }, 'snapshot: game not found')
      return
    }

    if (state === 'finished') {
      await sendFinishedSnapshot(socket, gameId, userId)
      return
    }

    const isWhite = state.whitePlayerId === userId
    let maskedFen = state.fen

    if (state.status === 'prep' && state.draft1Fen && state.draft2Fen) {
      const originalFen = buildCombinedDraftFen(state.draft1Fen, state.draft2Fen)
      maskedFen = maskOpponentAuxPlacements(state.fen, originalFen, isWhite)
    } else if (state.status === 'prep') {
      log.warn({ gameId }, 'snapshot: draft FEN missing during prep')
    }

    let timeRemainingOnMove = MOVE_TIME_LIMIT
    if (state.status === 'active' && state.lastMoveAt > 0) {
      const fenTurn = state.fen.split(' ')[1]
      const myTurn  = (fenTurn === 'w' && isWhite) || (fenTurn === 'b' && !isWhite)
      const elapsed = Date.now() - state.lastMoveAt
      if (myTurn) timeRemainingOnMove = Math.max(0, MOVE_TIME_LIMIT - elapsed)
    }

    socket.emit('game-snapshot', {
      fen:              maskedFen,
      status:           state.status as 'prep' | 'active' | 'finished',
      prepStartedAt:    state.prepStartedAt > 0
        ? new Date(state.prepStartedAt).toISOString()
        : null,
      readyPlayer1:     state.readyPlayer1,
      readyPlayer2:     state.readyPlayer2,
      auxPointsPlayer1: state.auxPointsPlayer1,
      auxPointsPlayer2: state.auxPointsPlayer2,
      moveNumber:       state.moveNumber,
      player1Timebank:  state.player1Timebank,
      player2Timebank:  state.player2Timebank,
      lastMoveAt:       state.lastMoveAt > 0
        ? new Date(state.lastMoveAt).toISOString()
        : null,
      timeRemainingOnMove,
      winnerId:         null,
      endReason:        undefined,
      player1EloAfter:  undefined,
      player2EloAfter:  undefined,
      eloChange:        undefined,
      player1Id:        state.player1Id,
      player2Id:        state.player2Id,
      isWhite,
    })

  } catch (err) {
    log.error({ gameId, userId, err }, 'snapshot error')
  }
}

async function sendFinishedSnapshot(
  socket: Sock,
  gameId: number,
  userId: number,
): Promise<void> {
  const snap = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      fen:             true,
      status:          true,
      player1Id:       true,
      player2Id:       true,
      whitePlayerId:   true,
      moveNumber:      true,
      player1Timebank: true,
      player2Timebank: true,
      lastMoveAt:      true,
      winnerId:        true,
      endReason:       true,
      player1EloAfter: true,
      player2EloAfter: true,
      eloChange:       true,
    },
  })

  if (!snap) {
    log.warn({ gameId }, 'finished snapshot: game not found in Postgres')
    return
  }

  const isWhite = snap.whitePlayerId === userId

  socket.emit('game-snapshot', {
    fen:              snap.fen ?? '',
    status:           'finished',
    prepStartedAt:    null,
    readyPlayer1:     true,
    readyPlayer2:     true,
    auxPointsPlayer1: 0,
    auxPointsPlayer2: 0,
    moveNumber:       snap.moveNumber,
    player1Timebank:  snap.player1Timebank,
    player2Timebank:  snap.player2Timebank,
    lastMoveAt:       snap.lastMoveAt?.toISOString() ?? null,
    timeRemainingOnMove: 0,
    winnerId:         snap.winnerId ?? null,
    endReason:        snap.endReason ?? undefined,
    player1EloAfter:  snap.player1EloAfter ?? undefined,
    player2EloAfter:  snap.player2EloAfter ?? undefined,
    eloChange:        snap.eloChange ?? undefined,
    player1Id:        snap.player1Id,
    player2Id:        snap.player2Id,
    isWhite,
  })
}