// apps/matchmaker/src/workers/prep.ts
//
// Auto-starts a game when the prep timer expires without both players readying.
// Fires 62 seconds after game creation — giving players the full 60s plus 2s
// buffer for network latency.
//
// When it fires, it transitions the game from prep to active in both
// Postgres and Redis, then schedules the initial timeout job.
//
// If both players readied before the timer fired, the ready route will have
// already transitioned the game — the Postgres updateMany guard returns 0
// and we skip cleanly.

import { Worker }          from 'bullmq'
import { prisma }          from '@draftchess/db'
import { buildCombinedDraftFen } from '@draftchess/shared/fen-utils'
import { loadGameState, updateGameState } from '@draftchess/game-state'
import { publishGameUpdate }    from '../lib/notify.js'
import { scheduleTimeout, redisOpts } from '../queues.js'
import { logger }               from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:prep-worker' })

export function createPrepWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'prep-queue',
    async (job) => {
      const { gameId } = job.data as { gameId: number }

      // ── Load game state ───────────────────────────────────────────────────
      // Use Redis first (fast path) — the hash was seeded at game creation.
      // Fall back to Postgres if Redis missed (restart scenario).
      const state = await loadGameState(publisher, gameId)

      if (!state || state === 'finished') {
        log.debug({ gameId }, 'game not found or already finished — skipping prep auto-start')
        return
      }

      if (state.status !== 'prep') {
        log.debug({ gameId, status: state.status }, 'game already started — skipping prep auto-start')
        return
      }

      // ── Determine active FEN ──────────────────────────────────────────────
      // Use the current FEN from Redis (may include aux placements made during prep).
      // Fall back to building from draft FENs if somehow missing.
      const activeFen = state.fen && state.fen.length > 0
        ? state.fen
        : state.draft1Fen && state.draft2Fen
          ? buildCombinedDraftFen(state.draft1Fen, state.draft2Fen)
          : null

      if (!activeFen) {
        log.error({ gameId }, 'no valid FEN available — cannot auto-start')
        return
      }

      const now            = new Date()
      const nowMs          = now.getTime()
      const player1Timebank = 60_000
      const player2Timebank = 60_000

      // ── Postgres transition ───────────────────────────────────────────────
      // Optimistic guard — if the ready route beat us, count === 0 and we skip.
      const guard = await prisma.game.updateMany({
        where: { id: gameId, status: 'prep' },
        data: {
          status:          'active',
          fen:             activeFen,
          lastMoveAt:      now,
          moveNumber:      0,
          player1Timebank,
          player2Timebank,
        },
      })

      if (guard.count === 0) {
        log.debug({ gameId }, 'ready route beat prep timer — skipping')
        return
      }

      // ── Redis transition ──────────────────────────────────────────────────
      // Mirror the Postgres transition in the Redis hash so the move route
      // and timeout worker see the updated state immediately.
      await updateGameState(publisher, gameId, {
        status:          'active',
        fen:             activeFen,
        lastMoveAt:      nowMs,
        lastMoveBy:      0,
        moveNumber:      0,
        readyPlayer1:    true,
        readyPlayer2:    true,
        player1Timebank,
        player2Timebank,
      })

      // ── Broadcast ─────────────────────────────────────────────────────────
      await publishGameUpdate(publisher, gameId, {
        status:          'active',
        fen:             activeFen,
        lastMoveAt:      now.toISOString(),
        player1Timebank,
        player2Timebank,
        moveNumber:      0,
        readyPlayer1:    true,
        readyPlayer2:    true,
      })

      // ── Schedule timeout ──────────────────────────────────────────────────
      // White moves first — fenTurn is always 'w' at game start.
      const whiteIsP1 = state.whitePlayerId === state.player1Id
      await scheduleTimeout(gameId, player1Timebank, player2Timebank, now, 'w', whiteIsP1)

      log.info({ gameId }, 'game auto-started by prep timer')
    },
    { connection: redisOpts, concurrency: 5 },
  )

  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'prep worker job failed'))
  worker.on('error',  (err)      => log.error({ err: err.message }, 'prep worker error'))

  return worker
}