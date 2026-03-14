// apps/matchmaker/src/workers/timeout.ts
import { Worker }       from 'bullmq'
import { prisma }       from '@draftchess/db'
import { type GameMode, GAMES_PLAYED_FIELD } from '@draftchess/shared/game-modes'
import { finalizeGame } from '../lib/finalize.js'
import { publishGameUpdate } from '../lib/notify.js'
import { timeoutQueue, redisOpts } from '../queues.js'
import type { RedisClientType } from 'redis'

export function createTimeoutWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'timeout-queue',
    async (job) => {
      const { gameId, scheduledAt } = job.data as { gameId: number; scheduledAt: string }

      const game = await prisma.game.findUnique({
        where:  { id: gameId },
        select: {
          id: true, status: true, fen: true, mode: true, isFriendGame: true,
          player1Id: true, player2Id: true, whitePlayerId: true,
          lastMoveAt: true, player1Timebank: true, player2Timebank: true,
          player1EloBefore: true, player2EloBefore: true,
          player1: {
            select: {
              gamesPlayedStandard: true,
              gamesPlayedPauper:   true,
              gamesPlayedRoyal:    true,
              username:            true,
            },
          },
          player2: {
            select: {
              gamesPlayedStandard: true,
              gamesPlayedPauper:   true,
              gamesPlayedRoyal:    true,
              username:            true,
            },
          },
        },
      })

      if (!game || game.status !== 'active') {
        console.log(`[timeout] game ${gameId} not active, skipping`)
        return
      }

      // Staleness check — if the move timestamp no longer matches what was
      // scheduled, a newer move was made and this job is stale.
      if (game.lastMoveAt && new Date(game.lastMoveAt).toISOString() !== scheduledAt) {
        console.log(`[timeout] game ${gameId} stale job (lastMoveAt changed), skipping`)
        return
      }

      const now      = Date.now()
      const elapsed  = now - new Date(game.lastMoveAt!).getTime()
      const turn     = game.fen!.split(' ')[1]! // 'w' or 'b'

      // Map FEN colour → player slot using whitePlayerId as source of truth
      const whiteIsP1 = game.whitePlayerId === game.player1Id
      const isP1Turn  = turn === 'w' ? whiteIsP1 : !whiteIsP1

      const timebank  = isP1Turn ? game.player1Timebank : game.player2Timebank
      const remaining = timebank - Math.max(0, elapsed - 30_000)

      if (remaining > 0) {
        // Still time left — reschedule for the remainder
        await timeoutQueue.add(
          'check-timeout',
          { gameId, scheduledAt },
          { delay: remaining, jobId: `timeout-${gameId}` },
        )
        return
      }

      const winnerId   = isP1Turn ? game.player2Id : game.player1Id
      const gameMode   = (game.mode ?? 'standard') as GameMode
      const gamesField = GAMES_PLAYED_FIELD[gameMode]

      const result = await finalizeGame(
        gameId,
        winnerId,
        game.player1Id,
        game.player2Id,
        game.player1EloBefore ?? 1200,
        game.player2EloBefore ?? 1200,
        game.player1[gamesField] ?? 0,
        game.player2[gamesField] ?? 0,
        'timeout',
        gameMode,
        game.isFriendGame ?? false,
      )

      if (!result) {
        console.log(`[timeout] game ${gameId} already finished by another path`)
        return
      }

      await publishGameUpdate(publisher, gameId, {
        status:          'finished',
        winnerId,
        endReason:       'timeout',
        player1EloAfter: result.newP1Elo,
        player2EloAfter: result.newP2Elo,
        eloChange:       result.eloChange,
      })

      console.log(`[timeout] game ${gameId} ended by timeout, winner: ${winnerId}`)
    },
    { connection: redisOpts, concurrency: 10 },
  )

  worker.on('failed', (job, err) => console.error(`[timeout-worker] job ${job?.id} failed:`, err.message))
  worker.on('error',  (err)      => console.error('[timeout-worker] error:', err.message))

  return worker
}
