// apps/matchmaker/src/workers/reconcile.ts
// Safety net worker — runs every 5 minutes.
// Finds active games that have been silent longer than the maximum possible
// time (30s move limit + full 60s timebank) and force-finishes them.
// This catches games whose timeout jobs were lost from Redis (crash, eviction).

import { Worker }       from 'bullmq'
import { prisma }       from '@draftchess/db'
import { type GameMode, GAMES_PLAYED_FIELD } from '@draftchess/shared/game-modes'
import { finalizeGame } from '../lib/finalize.js'
import { publishGameUpdate } from '../lib/notify.js'
import { timeoutQueue, redisOpts } from '../queues.js'
import type { RedisClientType } from 'redis'

const MOVE_TIME_MS    = 30_000
const MAX_TIMEBANK_MS = 60_000
// A game silent longer than this MUST have timed out
const STALE_THRESHOLD_MS = MOVE_TIME_MS + MAX_TIMEBANK_MS + 5_000

export function createReconcileWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'reconcile-queue',
    async (_job) => {
      const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS)

      const staleGames = await prisma.game.findMany({
        where: {
          status:     'active',
          lastMoveAt: { lt: staleCutoff },
        },
        select: {
          id: true, fen: true, lastMoveAt: true, mode: true, isFriendGame: true,
          player1Id: true, player2Id: true, whitePlayerId: true,
          player1Timebank: true, player2Timebank: true,
          player1EloBefore: true, player2EloBefore: true,
          player1: {
            select: {
              gamesPlayedStandard: true,
              gamesPlayedPauper:   true,
              gamesPlayedRoyal:    true,
            },
          },
          player2: {
            select: {
              gamesPlayedStandard: true,
              gamesPlayedPauper:   true,
              gamesPlayedRoyal:    true,
            },
          },
        },
      })

      if (staleGames.length === 0) return
      console.log(`[reconcile] found ${staleGames.length} stale active game(s)`)

      for (const game of staleGames) {
        try {
          // If a timeout job exists for this game it hasn't fired yet — skip.
          // The job will resolve it; we only step in when the job is gone.
          const existing = await timeoutQueue.getJob(`timeout-${game.id}`)
          if (existing) {
            console.log(`[reconcile] game ${game.id} has a pending timeout job, skipping`)
            continue
          }

          // Map FEN turn → active player using whitePlayerId as source of truth
          const fenTurn   = game.fen && game.fen.length > 0 ? game.fen.split(' ')[1]! : 'w'
          const whiteIsP1 = game.whitePlayerId === game.player1Id
          const isP1Turn  = fenTurn === 'w' ? whiteIsP1 : !whiteIsP1
          const winnerId  = isP1Turn ? game.player2Id : game.player1Id

          console.log(`[reconcile] force-finishing game ${game.id} (winner: ${winnerId})`)

          const gameMode   = (game.mode ?? 'standard') as GameMode
          const gamesField = GAMES_PLAYED_FIELD[gameMode]

          const result = await finalizeGame(
            game.id,
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

          if (result) {
            await publishGameUpdate(publisher, game.id, {
              status:          'finished',
              winnerId,
              endReason:       'timeout',
              player1EloAfter: result.newP1Elo,
              player2EloAfter: result.newP2Elo,
              eloChange:       result.eloChange,
            })
          }
        } catch (err: any) {
          console.error(`[reconcile] failed to process game ${game.id}:`, err.message)
        }
      }
    },
    { connection: redisOpts, concurrency: 1 },
  )

  worker.on('failed', (job, err) => console.error(`[reconcile-worker] job ${job?.id} failed:`, err.message))
  worker.on('error',  (err)      => console.error('[reconcile-worker] error:', err.message))

  return worker
}
