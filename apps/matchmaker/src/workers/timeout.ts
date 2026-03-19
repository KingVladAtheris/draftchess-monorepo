// apps/matchmaker/src/workers/timeout.ts
//
// Processes timeout jobs scheduled by the game-started subscriber and
// after every move. Reads game state from Redis (fast path) with Postgres
// fallback. Passes publisher to finalizeGame so it can delete the Redis hash.

import { Worker }            from 'bullmq'
import { loadGameState }     from '@draftchess/game-state'
import { type GameMode }     from '@draftchess/shared/game-modes'
import { finalizeGame }      from '../lib/finalize.js'
import { publishGameUpdate } from '../lib/notify.js'
import { timeoutQueue, redisOpts } from '../queues.js'
import { logger }            from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:timeout-worker' })

export function createTimeoutWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'timeout-queue',
    async (job) => {
      const { gameId, scheduledAt } = job.data as { gameId: number; scheduledAt: string }

      // ── Load game state from Redis (fast path) ──────────────────────────────
      const state = await loadGameState(publisher, gameId)

      if (!state || state === 'finished') {
        log.debug({ gameId }, 'game not active or finished — skipping timeout')
        return
      }

      if (state.status !== 'active') {
        log.debug({ gameId, status: state.status }, 'game not active — skipping timeout')
        return
      }

      // ── Staleness check ─────────────────────────────────────────────────────
      // If lastMoveAt no longer matches what was scheduled, a newer move was
      // made after this job was enqueued. Discard silently.
      const lastMoveAtIso = state.lastMoveAt
        ? new Date(state.lastMoveAt).toISOString()
        : null

      if (lastMoveAtIso !== scheduledAt) {
        log.debug({ gameId, scheduledAt, lastMoveAt: lastMoveAtIso }, 'stale timeout job — skipping')
        return
      }

      // ── Time accounting ─────────────────────────────────────────────────────
      const now     = Date.now()
      const elapsed = now - state.lastMoveAt
      const fenTurn = state.fen.split(' ')[1] ?? 'w'

      // Map FEN colour → player slot using whitePlayerId as source of truth
      const whiteIsP1 = state.whitePlayerId === state.player1Id
      const isP1Turn  = fenTurn === 'w' ? whiteIsP1 : !whiteIsP1

      const timebank  = isP1Turn ? state.player1Timebank : state.player2Timebank
      const remaining = timebank - Math.max(0, elapsed - 30_000)

      if (remaining > 0) {
        // Still time left — reschedule for the remainder
        await timeoutQueue.add(
          'check-timeout',
          { gameId, scheduledAt },
          { delay: remaining, jobId: `timeout-${gameId}` },
        )
        log.debug({ gameId, remaining }, 'time remaining — rescheduled')
        return
      }

      // ── Time expired — finalize ─────────────────────────────────────────────
      const winnerId = isP1Turn ? state.player2Id : state.player1Id

      const result = await finalizeGame(
        gameId,
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

      if (!result) {
        log.info({ gameId }, 'game already finished by another path')
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

      log.info({ gameId, winnerId }, 'game ended by timeout')
    },
    { connection: redisOpts, concurrency: 10 },
  )

  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'timeout worker job failed'))
  worker.on('error',  (err)      => log.error({ err: err.message }, 'timeout worker error'))

  return worker
}