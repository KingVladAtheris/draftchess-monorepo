// apps/matchmaker/src/workers/reconcile.ts
//
// Safety net worker — runs every 5 minutes.
// Finds active games that have been silent longer than the maximum possible
// time (30s move limit + full 60s timebank) and force-finishes them.
// This catches games whose timeout jobs were lost from Redis (crash, eviction).
//
// With Redis game state, this worker reads from Redis first (fast path)
// and falls back to Postgres. The staleness threshold is checked against
// lastMoveAt in the Redis hash rather than the Postgres row.

import { Worker }          from 'bullmq'
import { prisma }          from '@draftchess/db'
import { type GameMode }   from '@draftchess/shared/game-modes'
import { loadGameState }   from '@draftchess/game-state'
import { finalizeGame }    from '../lib/finalize.js'
import { publishGameUpdate } from '../lib/notify.js'
import { timeoutQueue, redisOpts } from '../queues.js'
import { logger }          from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:reconcile-worker' })

const MOVE_TIME_MS       = 30_000
const MAX_TIMEBANK_MS    = 60_000
const STALE_THRESHOLD_MS = MOVE_TIME_MS + MAX_TIMEBANK_MS + 5_000

export function createReconcileWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'reconcile-queue',
    async (_job) => {
      const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS)

      // Query Postgres for active games that appear stale by lastMoveAt.
      // We use Postgres here (not Redis) so we catch games whose Redis hash
      // has expired but Postgres still shows them as active — exactly the
      // scenario this worker exists to handle.
      const staleGames = await prisma.game.findMany({
        where: {
          status:     'active',
          lastMoveAt: { lt: staleCutoff },
        },
        select: {
          id:           true,
          mode:         true,
          isFriendGame: true,
          player1Id:    true,
          player2Id:    true,
        },
      })

      if (staleGames.length === 0) return

      log.info({ count: staleGames.length }, 'found stale active games')

      for (const game of staleGames) {
        try {
          // If a timeout job exists, it hasn't fired yet — skip.
          // The job will resolve it; we only step in when the job is gone.
          const existing = await timeoutQueue.getJob(`timeout-${game.id}`)
          if (existing) {
            log.debug({ gameId: game.id }, 'pending timeout job exists — skipping reconcile')
            continue
          }

          // Load full game state — Redis first, Postgres fallback.
          // loadGameState handles both paths; no need to call getGameState directly.
          const state = await loadGameState(publisher, game.id)

          if (!state || state === 'finished') {
            log.debug({ gameId: game.id }, 'game not in Redis and not active — skipping')
            continue
          }

          if (state.status !== 'active') {
            log.debug({ gameId: game.id, status: state.status }, 'game not active — skipping')
            continue
          }

          // Double-check staleness against the Redis hash's lastMoveAt
          // (which may differ from Postgres if moves were made after the
          // Postgres lastMoveAt was last written)
          const lastMoveAge = Date.now() - state.lastMoveAt
          if (lastMoveAge < STALE_THRESHOLD_MS) {
            log.debug({ gameId: game.id, lastMoveAge }, 'game not stale per Redis — skipping')
            continue
          }

          // Map FEN turn → active player
          const fenTurn   = state.fen.split(' ')[1] ?? 'w'
          const whiteIsP1 = state.whitePlayerId === state.player1Id
          const isP1Turn  = fenTurn === 'w' ? whiteIsP1 : !whiteIsP1
          const winnerId  = isP1Turn ? state.player2Id : state.player1Id

          log.info({ gameId: game.id, winnerId }, 'force-finishing stale game')

          const result = await finalizeGame(
            game.id,
            winnerId,
            state.player1Id,
            state.player2Id,
            state.player1EloBefore,
            state.player2EloBefore,
            state.player1GamesPlayed,
            state.player2GamesPlayed,
            'timeout',
            (state.mode ?? 'standard') as GameMode,
            state.isFriendGame,
            publisher,
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
          log.error({ gameId: game.id, err: err.message }, 'failed to process stale game')
        }
      }
    },
    { connection: redisOpts, concurrency: 1 },
  )

  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'reconcile worker job failed'))
  worker.on('error',  (err)      => log.error({ err: err.message }, 'reconcile worker error'))

  return worker
}