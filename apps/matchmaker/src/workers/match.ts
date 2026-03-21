// apps/matchmaker/src/workers/match.ts
//
// CHANGE: After creating a game, writes matched:{userId} to Redis for both
// players with a 5-minute TTL. The queue/status endpoint reads this key
// on the fast path, avoiding a Postgres query on every poll tick.

import { Worker }                from 'bullmq'
import { prisma }                from '@draftchess/db'
import { buildCombinedDraftFen } from '@draftchess/shared/fen-utils'
import {
  type GameMode,
  MODE_CONFIG,
  ELO_FIELD,
  GAMES_PLAYED_FIELD,
} from '@draftchess/shared/game-modes'
import { seedGameState }         from '@draftchess/game-state'
import { notifyMatch }           from '../lib/notify.js'
import { matchQueue, prepQueue, redisOpts } from '../queues.js'
import { logger }                from '@draftchess/logger'
import type { RedisClientType }  from 'redis'
import type { SeedGameStatePayload } from '@draftchess/game-state'

const log = logger.child({ module: 'matchmaker:match-worker' })

const MATCHED_KEY_TTL = 300 // 5 minutes

function maxEloDiff(queuedAtMs: number): number {
  const secsWaiting = (Date.now() - queuedAtMs) / 1000
  return 200 + Math.floor(secsWaiting / 30) * 50
}

type QueuedPlayer = {
  id:            number
  username:      string
  queuedDraftId: number | null
  queuedMode:    string | null
  queuedAt:      Date | null
  eloStandard:   number
  eloPauper:     number
  eloRoyal:      number
  gamesPlayedStandard: number
  gamesPlayedPauper:   number
  gamesPlayedRoyal:    number
}

function findBestMatch(
  target:     QueuedPlayer,
  candidates: QueuedPlayer[],
): QueuedPlayer | null {
  if (candidates.length === 0) return null

  const sameMode = candidates.filter(p => p.queuedMode === target.queuedMode)
  if (sameMode.length === 0) {
    log.debug({ username: target.username, mode: target.queuedMode }, 'no opponents in same mode')
    return null
  }

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
    log.debug(
      { username: target.username, mode, diff: best.diff, limit },
      'no suitable opponent within ELO range',
    )
    return null
  }

  return best
}

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
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      })

      if (queuedPlayers.length < 2) return

      const player1 = queuedPlayers[0]!
      const player2 = findBestMatch(player1, queuedPlayers.slice(1))
      if (!player2) return

      const mode         = (player1.queuedMode ?? 'standard') as GameMode
      const modeEloField = ELO_FIELD[mode]
      const gamesField   = GAMES_PLAYED_FIELD[mode]
      const p1Elo        = player1[modeEloField] ?? 1200
      const p2Elo        = player2[modeEloField] ?? 1200
      const auxPoints    = MODE_CONFIG[mode].auxPoints

      log.info(
        { p1: player1.username, p1Elo, p2: player2.username, p2Elo, mode },
        'pairing players',
      )

      const [draft1, draft2] = await Promise.all([
        prisma.draft.findUnique({ where: { id: player1.queuedDraftId! }, select: { fen: true } }),
        prisma.draft.findUnique({ where: { id: player2.queuedDraftId! }, select: { fen: true } }),
      ])

      if (!draft1 || !draft2) {
        log.error({ p1: player1.username, p2: player2.username }, 'draft not found — clearing from queue')
        await prisma.user.updateMany({
          where: { id: { in: [player1.id, player2.id] } },
          data:  { queueStatus: 'offline', queuedAt: null, queuedDraftId: null },
        })
        return
      }

      const isPlayer1White = Math.random() > 0.5
      const whiteDraftFen  = isPlayer1White ? draft1.fen : draft2.fen
      const blackDraftFen  = isPlayer1White ? draft2.fen : draft1.fen
      const gameFen        = buildCombinedDraftFen(whiteDraftFen, blackDraftFen)

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

      const seedPayload: SeedGameStatePayload = {
        gameId:        game.id,
        player1Id:     player1.id,
        player2Id:     player2.id,
        whitePlayerId: isPlayer1White ? player1.id : player2.id,
        mode,
        isFriendGame:  false,
        fen:           gameFen,
        prepStartedAt: now.getTime(),
        auxPointsPlayer1: auxPoints,
        auxPointsPlayer2: auxPoints,
        player1Timebank:  60_000,
        player2Timebank:  60_000,
        draft1Fen: whiteDraftFen,
        draft2Fen: blackDraftFen,
        player1EloBefore:   p1Elo,
        player2EloBefore:   p2Elo,
        player1GamesPlayed: player1[gamesField] ?? 0,
        player2GamesPlayed: player2[gamesField] ?? 0,
      }

      await seedGameState(publisher, seedPayload)

      await prisma.user.updateMany({
        where: { id: { in: [player1.id, player2.id] } },
        data:  { queueStatus: 'in_game', queuedAt: null, queuedDraftId: null },
      })

      // Write matched:{userId} keys so the queue/status endpoint can answer
      // polling clients from Redis without hitting Postgres.
      await Promise.all([
        publisher.set(`matched:${player1.id}`, String(game.id), { EX: MATCHED_KEY_TTL }),
        publisher.set(`matched:${player2.id}`, String(game.id), { EX: MATCHED_KEY_TTL }),
      ])

      await notifyMatch(publisher, game.id, [player1.id, player2.id])

      await prepQueue.add(
        'prep-start',
        { gameId: game.id },
        { delay: 62_000, jobId: `prep-${game.id}` },
      )

      log.info({ gameId: game.id, mode, p1: player1.username, p2: player2.username }, 'game created')
    },
    { connection: redisOpts, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'match worker job failed')
    if (job?.name === 'try-match') {
      matchQueue
        .add('try-match', {}, { delay: 5_000 })
        .catch(e => log.error({ err: e.message }, 'match worker re-queue failed'))
    }
  })

  worker.on('error', (err) => log.error({ err: err.message }, 'match worker error'))

  return worker
}
