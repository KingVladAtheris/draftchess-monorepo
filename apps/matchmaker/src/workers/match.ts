// apps/matchmaker/src/workers/match.ts
import { Worker }          from 'bullmq'
import { prisma }          from '@draftchess/db'
import { buildCombinedDraftFen } from '@draftchess/shared/fen-utils'
import {
  type GameMode,
  MODE_CONFIG,
  ELO_FIELD,
} from '@draftchess/shared/game-modes'
import { notifyMatch }     from '../lib/notify.js'
import { matchQueue, prepQueue, redisOpts } from '../queues.js'
import type { RedisClientType } from 'redis'

// ── ELO pairing helpers ───────────────────────────────────────────────────────

function maxEloDiff(queuedAtMs: number): number {
  const secsWaiting = (Date.now() - queuedAtMs) / 1000
  return 200 + Math.floor(secsWaiting / 30) * 50
}

type QueuedPlayer = {
  id:            number
  username:      string
  queuedDraftId: number | null
  queuedMode:    string | null
  queuedAt:      Date | null  // nullable in schema — Prisma returns Date | null
  eloStandard:   number
  eloPauper:     number
  eloRoyal:      number
}

function findBestMatch(
  target:     QueuedPlayer,
  candidates: QueuedPlayer[],
): QueuedPlayer | null {
  if (candidates.length === 0) return null

  const sameMode = candidates.filter(p => p.queuedMode === target.queuedMode)
  if (sameMode.length === 0) {
    console.log(`[match] no opponents in same mode (${target.queuedMode}) for ${target.username}`)
    return null
  }

  // queuedAt should always be set for queued players, but guard against null
  const queuedAtMs   = target.queuedAt ? new Date(target.queuedAt).getTime() : Date.now()
  const mode         = (target.queuedMode ?? 'standard') as GameMode
  const modeEloField = ELO_FIELD[mode]
  const targetElo    = target[modeEloField] ?? 1200
  const limit        = maxEloDiff(queuedAtMs)

  const sorted = sameMode
    .map(p => ({ ...p, diff: Math.abs((p[modeEloField] ?? 1200) - targetElo) }))
    .sort((a, b) => a.diff - b.diff)

  const best = sorted[0]!
  if (best.diff > limit) {
    console.log(
      `[match] no suitable opponent for ${target.username} ` +
      `(mode=${mode}, diff=${best.diff}, limit=${limit})`,
    )
    return null
  }

  return best
}

// ── Worker ────────────────────────────────────────────────────────────────────

export function createMatchWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'match-queue',
    async (_job) => {
      const queuedPlayers = await prisma.user.findMany({
        where:   { queueStatus: 'queued' },
        orderBy: { queuedAt: 'asc' },
        select: {
          id: true, username: true,
          queuedDraftId: true, queuedMode: true, queuedAt: true,
          eloStandard: true, eloPauper: true, eloRoyal: true,
        },
      })

      if (queuedPlayers.length < 2) return

      const player1 = queuedPlayers[0]!
      const player2 = findBestMatch(player1, queuedPlayers.slice(1))
      if (!player2) return

      const mode         = (player1.queuedMode ?? 'standard') as GameMode
      const modeEloField = ELO_FIELD[mode]
      const p1Elo        = player1[modeEloField] ?? 1200
      const p2Elo        = player2[modeEloField] ?? 1200
      const auxPoints    = MODE_CONFIG[mode].auxPoints

      console.log(
        `[match] pairing ${player1.username} (${p1Elo}) vs ${player2.username} (${p2Elo}) mode=${mode}`,
      )

      const [draft1, draft2] = await Promise.all([
        prisma.draft.findUnique({ where: { id: player1.queuedDraftId! }, select: { fen: true } }),
        prisma.draft.findUnique({ where: { id: player2.queuedDraftId! }, select: { fen: true } }),
      ])

      if (!draft1 || !draft2) {
        console.error('[match] draft not found, clearing players from queue')
        await prisma.user.updateMany({
          where: { id: { in: [player1.id, player2.id] } },
          data:  { queueStatus: 'offline', queuedAt: null, queuedDraftId: null },
        })
        return
      }

      const isPlayer1White = Math.random() > 0.5
      const gameFen = buildCombinedDraftFen(
        isPlayer1White ? draft1.fen : draft2.fen,
        isPlayer1White ? draft2.fen : draft1.fen,
      )

      const now  = new Date()
      const game = await prisma.game.create({
        data: {
          player1Id:        player1.id,
          player2Id:        player2.id,
          whitePlayerId:    isPlayer1White ? player1.id : player2.id,
          draft1Id:         isPlayer1White ? player1.queuedDraftId : player2.queuedDraftId,
          draft2Id:         isPlayer1White ? player2.queuedDraftId : player1.queuedDraftId,
          fen:              gameFen,
          status:           'prep',
          mode,
          prepStartedAt:    now,
          readyPlayer1:     false,
          readyPlayer2:     false,
          auxPointsPlayer1: auxPoints,
          auxPointsPlayer2: auxPoints,
          player1EloBefore: p1Elo,
          player2EloBefore: p2Elo,
        },
      })

      await prisma.user.updateMany({
        where: { id: { in: [player1.id, player2.id] } },
        data:  { queueStatus: 'in_game', queuedAt: null, queuedDraftId: null },
      })

      await notifyMatch(publisher, game.id, [player1.id, player2.id])

      await prepQueue.add(
        'prep-start',
        { gameId: game.id },
        { delay: 62_000, jobId: `prep-${game.id}` },
      )

      console.log(`[match] game ${game.id} created`)
    },
    { connection: redisOpts, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[match-worker] job ${job?.id} failed:`, err.message)
    if (job?.name === 'try-match') {
      matchQueue
        .add('try-match', {}, { delay: 5_000 })
        .catch(e => console.error('[match-worker] re-queue failed:', e.message))
    }
  })

  worker.on('error', (err) => console.error('[match-worker] error:', err.message))

  return worker
}