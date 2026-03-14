// apps/matchmaker/src/workers/prep.ts
import { Worker }     from 'bullmq'
import { prisma }     from '@draftchess/db'
import { buildCombinedDraftFen } from '@draftchess/shared/fen-utils'
import { publishGameUpdate } from '../lib/notify.js'
import { scheduleTimeout, redisOpts } from '../queues.js'
import type { RedisClientType } from 'redis'

export function createPrepWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'prep-queue',
    async (job) => {
      const { gameId } = job.data as { gameId: number }

      const g = await prisma.game.findUnique({
        where:  { id: gameId },
        select: {
          id: true, status: true, fen: true, prepStartedAt: true,
          player1Id: true, whitePlayerId: true,
          draft1: { select: { fen: true } },
          draft2: { select: { fen: true } },
        },
      })

      if (!g || g.status !== 'prep') {
        console.log(`[prep] game ${gameId} already started or not found, skipping`)
        return
      }

      // Use existing FEN if present (players may have placed aux pieces).
      // Fall back to building from drafts if somehow missing.
      const activeFen =
        g.fen && g.fen.length > 0
          ? g.fen
          : g.draft1?.fen && g.draft2?.fen
            ? buildCombinedDraftFen(g.draft1.fen, g.draft2.fen)
            : null

      if (!activeFen) {
        console.error(`[prep] game ${gameId} has no valid FEN, cannot auto-start`)
        return
      }

      const now   = new Date()
      const guard = await prisma.game.updateMany({
        where: { id: gameId, status: 'prep' },
        data: {
          status:          'active',
          fen:             activeFen,
          lastMoveAt:      now,
          moveNumber:      0,
          player1Timebank: 60_000,
          player2Timebank: 60_000,
        },
      })

      if (guard.count === 0) {
        // The ready route beat us — both players readied up before the timer fired
        console.log(`[prep] game ${gameId} already started by ready route, skipping`)
        return
      }

      await publishGameUpdate(publisher, gameId, {
        status:          'active',
        fen:             activeFen,
        lastMoveAt:      now.toISOString(),
        player1Timebank: 60_000,
        player2Timebank: 60_000,
        moveNumber:      0,
        readyPlayer1:    true,
        readyPlayer2:    true,
      })

      await scheduleTimeout(gameId, 60_000, 60_000, now, 'w', g.whitePlayerId === g.player1Id)
      console.log(`[prep] game ${gameId} auto-started`)
    },
    { connection: redisOpts, concurrency: 5 },
  )

  worker.on('failed', (job, err) => console.error(`[prep-worker] job ${job?.id} failed:`, err.message))
  worker.on('error',  (err)      => console.error('[prep-worker] error:', err.message))

  return worker
}
