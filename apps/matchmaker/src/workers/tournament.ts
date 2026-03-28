// apps/matchmaker/src/workers/tournament.ts
//
// BullMQ worker consuming "tournament-queue".
//
// Two-phase round lifecycle:
//   Phase 1 — awaiting_drafts: pairings created, players notified via
//             Socket.IO to pick a draft. BullMQ draft-deadline job fires
//             after 3 minutes.
//   Phase 2 — active: drafts assigned (picked or auto-assigned from most
//             recently updated draft for the mode), Game rows created,
//             players notified to navigate to their game.
//
// ELO-neutral: tournament games call finalizeTournamentGame() which updates
// game status + resets queue state but never writes ELO fields.
//
// Job types:
//   stage-start     — pending → active, kick off round 1
//   round-start     — create pairings, open 3-min pick window, schedule deadline
//   draft-deadline  — auto-assign missing drafts, create Game rows
//   round-check     — fired when any game in round finishes; closes round if all done
//   stage-finish    — compute placements, eliminate players, schedule next stage

import { Worker, Queue }              from 'bullmq'
import { prisma }                     from '@draftchess/db'
import { logger }                     from '@draftchess/logger'
import {
  pairSwissRound,
  pairEliminationRound,
  buildRoundRobinSchedule,
  recordTournamentGameResult,
  computePlacements,
  distributePrizes,
  PlacementResult,
  type Pairing,
}                                     from '@draftchess/tournament-engine'
import { seedGameState }              from '@draftchess/game-state'
import { buildCombinedDraftFen }      from '@draftchess/shared/fen-utils'
import { MODE_CONFIG, type GameMode } from '@draftchess/shared/game-modes'
import { redisOpts }                  from '../queues.js'
import type { RedisClientType }       from 'redis'

const log = logger.child({ module: 'matchmaker:tournament' })

// 1-minute pick window — after this, most-recently-updated draft is auto-assigned
const DRAFT_PICK_WINDOW_MS = 1 * 60 * 1000

export const tournamentQueue = new Queue('tournament-queue', {
  connection:        redisOpts,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
})

// ─── Worker ───────────────────────────────────────────────────────────────────

export function createTournamentWorker(publisher: RedisClientType) {
  const worker = new Worker(
    'tournament-queue',
    async (job) => {
      const { type, ...data } = job.data as { type: string; [k: string]: unknown }
      log.debug({ type, data }, 'tournament job received')

      switch (type) {
        case 'stage-start':    return handleStageStart(data.stageId as number, publisher)
        case 'round-start':    return handleRoundStart(data.stageId as number, data.roundNumber as number, publisher)
        case 'draft-deadline': return handleDraftDeadline(data.roundId as number, publisher)
        case 'round-check':    return handleRoundCheck(data.roundId as number, publisher)
        case 'stage-finish':   return handleStageFinish(data.stageId as number, publisher)
        default:
          log.warn({ type }, 'unknown tournament job type — ignoring')
      }
    },
    { connection: redisOpts, concurrency: 3 },
  )

  worker.on('failed', (job, err) =>
    log.error({ jobId: job?.id, jobType: job?.data?.type, err: err.message }, 'tournament job failed'),
  )

  return worker
}

// ─── Stage start ──────────────────────────────────────────────────────────────

async function handleStageStart(stageId: number, publisher: RedisClientType): Promise<void> {
  const stage = await prisma.tournamentStage.findUnique({ where: { id: stageId } })

  if (!stage) {
    log.warn({ stageId }, 'handleStageStart: stage not found')
    return
  }
  if (stage.status !== 'pending') {
    log.debug({ stageId, status: stage.status }, 'handleStageStart: not pending — skip')
    return
  }

  await prisma.tournamentStage.update({
    where: { id: stageId },
    data:  { status: 'active', startedAt: new Date() },
  })

  // Round robin: pre-create all TournamentRound + TournamentGame rows now.
  // Each round opens its pick window when it's its turn.
  if (stage.format === 'round_robin') {
    const playerIds = await getActivePlayerIds(stage.tournamentId)
    const schedule  = buildRoundRobinSchedule(playerIds)

    for (let r = 0; r < schedule.length; r++) {
      const round = await prisma.tournamentRound.create({
        data: { stageId, roundNumber: r + 1 },
      })
      for (const p of schedule[r]!) {
        await prisma.tournamentGame.create({
          data: {
            roundId:   round.id,
            player1Id: p.player1Id,
            player2Id: p.player2Id,
            isBye:     p.player2Id === -1,
            // BYE result is immediate
            winnerId:  p.player2Id === -1 ? p.player1Id : null,
          },
        })
      }
    }
  }

  await tournamentQueue.add('tournament', {
    type: 'round-start', stageId, roundNumber: 1,
  })

  log.info({ stageId, format: stage.format }, 'stage started')
}

// ─── Round start ──────────────────────────────────────────────────────────────
// Phase 1: create/activate round, open 3-min draft pick window.

async function handleRoundStart(
  stageId:     number,
  roundNumber: number,
  publisher:   RedisClientType,
): Promise<void> {
  const stage = await prisma.tournamentStage.findUnique({
    where:   { id: stageId },
    include: { tournament: true },
  })

  if (!stage) { log.warn({ stageId }, 'handleRoundStart: stage not found'); return }
  if (stage.status !== 'active') {
    log.debug({ stageId, status: stage.status }, 'handleRoundStart: stage not active — skip')
    return
  }

  const deadline = new Date(Date.now() + DRAFT_PICK_WINDOW_MS)

  // Round robin: round already exists — just open pick window
  let round = await prisma.tournamentRound.findUnique({
    where: { stageId_roundNumber: { stageId, roundNumber } },
  })

  if (!round) {
    // Swiss or elimination: compute pairings now and create the round
    let pairings: Pairing[]
    if (stage.format === 'swiss') {
      pairings = await pairSwissRound(stageId)
    } else {
      pairings = await pairEliminationRound(stageId, roundNumber)
    }

    round = await prisma.tournamentRound.create({
      data: { stageId, roundNumber, status: 'awaiting_drafts', draftPickDeadline: deadline },
    })

    for (const p of pairings) {
      await prisma.tournamentGame.create({
        data: {
          roundId:   round.id,
          player1Id: p.player1Id,
          player2Id: p.player2Id,
          isBye:     p.player2Id === -1,
          winnerId:  p.player2Id === -1 ? p.player1Id : null,
        },
      })
    }
  } else {
    round = await prisma.tournamentRound.update({
      where: { id: round.id },
      data:  { status: 'awaiting_drafts', draftPickDeadline: deadline },
    })
  }

  // Notify every non-BYE player to pick their draft
  const games     = await prisma.tournamentGame.findMany({
    where: { roundId: round.id, isBye: false },
  })
  const playerIds = [...new Set(games.flatMap(g => [g.player1Id, g.player2Id]))]

  for (const userId of playerIds) {
    await publisher.publish('draftchess:notifications', JSON.stringify({
      type:             'notification',
      userId,
      notificationType: 'tournament_pick_draft',
      payload: {
        tournamentId: stage.tournamentId,
        stageId,
        roundId:      round.id,
        roundNumber,
        deadlineAt:   deadline.toISOString(),
        mode:         stage.tournament.mode,
      },
    }))
  }

  // Schedule auto-assign deadline job with a stable jobId so it can be
  // cancelled early when both players pick before the window closes
  await tournamentQueue.add(
    'tournament',
    { type: 'draft-deadline', roundId: round.id },
    { delay: DRAFT_PICK_WINDOW_MS, jobId: `draft-deadline-${round.id}` },
  )

  log.info(
    { stageId, roundNumber, roundId: round.id, players: playerIds.length },
    'draft pick window open',
  )
}

// ─── Draft deadline ───────────────────────────────────────────────────────────
// Phase 2: auto-assign missing drafts, create Game rows, activate round.

async function handleDraftDeadline(roundId: number, publisher: RedisClientType): Promise<void> {
  const round = await prisma.tournamentRound.findUnique({
    where:   { id: roundId },
    include: {
      games: true,
      stage: { include: { tournament: true } },
    },
  })

  if (!round) { log.warn({ roundId }, 'handleDraftDeadline: round not found'); return }
  if (round.status !== 'awaiting_drafts') {
    log.debug({ roundId, status: round.status }, 'handleDraftDeadline: not awaiting_drafts — skip')
    return
  }

  const mode      = round.stage.tournament.mode as GameMode
  const auxPoints = MODE_CONFIG[mode].auxPoints

  for (const tGame of round.games) {
    // Skip BYEs and games already created (both players picked early)
    if (tGame.isBye || tGame.gameId) continue

    let p1DraftId = tGame.player1DraftId
    let p2DraftId = tGame.player2DraftId

    // Auto-assign: most recently updated draft for this mode
    if (!p1DraftId) p1DraftId = await getLastUpdatedDraft(tGame.player1Id, mode)
    if (!p2DraftId) p2DraftId = await getLastUpdatedDraft(tGame.player2Id, mode)

    // If a player has absolutely no draft in this mode: forfeit this game.
    // The round still progresses — game is marked done without a Game row.
    if (!p1DraftId || !p2DraftId) {
      const forfeitWinnerId = p1DraftId ? tGame.player1Id : tGame.player2Id

      await prisma.tournamentGame.update({
        where: { id: tGame.id },
        data:  { winnerId: forfeitWinnerId, isDraw: false },
      })

      await recordTournamentGameResult({
        tournamentGameId: tGame.id,
        winnerId:         forfeitWinnerId,
        isDraw:           false,
      })

      log.warn(
        { tGameId: tGame.id, p1HasDraft: !!p1DraftId, p2HasDraft: !!p2DraftId },
        'tournament game forfeited — player has no draft in this mode',
      )
      continue
    }

    // Save auto-assigned draft IDs
    await prisma.tournamentGame.update({
      where: { id: tGame.id },
      data:  { player1DraftId: p1DraftId, player2DraftId: p2DraftId },
    })

    // Create the live Game row and notify players
    await createLiveGame(
      { ...tGame, player1DraftId: p1DraftId, player2DraftId: p2DraftId },
      round.stage.tournament,
      mode,
      auxPoints,
      publisher,
    )
  }

  await prisma.tournamentRound.update({
    where: { id: roundId },
    data:  { status: 'active', startedAt: new Date() },
  })

  log.info({ roundId }, 'draft deadline processed — round now active')
}

// ─── Round check ──────────────────────────────────────────────────────────────
// Called when any game in this round finishes. If all games are done,
// closes the round and triggers the next round or stage finish.

async function handleRoundCheck(roundId: number, publisher: RedisClientType): Promise<void> {
  const round = await prisma.tournamentRound.findUnique({
    where:   { id: roundId },
    include: { games: true, stage: true },
  })

  if (!round) return
  if (round.status !== 'active') return

  // Every game must have a winner (or be a draw or bye)
  const allDone = round.games.every(g =>
    g.isBye || g.isDraw || g.winnerId !== null,
  )
  if (!allDone) return

  await prisma.tournamentRound.update({
    where: { id: roundId },
    data:  { status: 'finished', finishedAt: new Date() },
  })

  const stage       = round.stage
  const totalRounds = stage.totalRounds

  const isLastRound = totalRounds
    ? round.roundNumber >= totalRounds
    : isEliminationFinal(round.games)

  if (isLastRound) {
    await tournamentQueue.add('tournament', { type: 'stage-finish', stageId: stage.id })
  } else {
    await tournamentQueue.add('tournament', {
      type:        'round-start',
      stageId:     stage.id,
      roundNumber: round.roundNumber + 1,
    })
  }

  log.info({ roundId, roundNumber: round.roundNumber, isLastRound }, 'round finished')
}

// ─── Stage finish ─────────────────────────────────────────────────────────────

async function handleStageFinish(stageId: number, publisher: RedisClientType): Promise<void> {
  const stage = await prisma.tournamentStage.findUnique({
    where:   { id: stageId },
    include: {
      tournament: {
        include: { stages: { orderBy: { stageNumber: 'asc' } } },
      },
    },
  })

  if (!stage) { log.warn({ stageId }, 'handleStageFinish: stage not found'); return }
  if (stage.status === 'finished') {
    log.debug({ stageId }, 'handleStageFinish: already finished — skip')
    return
  }

  // Compute and persist placements
  const placements: PlacementResult[] = await computePlacements(stageId)

  await prisma.$transaction(
    placements.map(p =>
      prisma.tournamentStagePlacement.upsert({
        where:  { stageId_userId: { stageId, userId: p.userId } },
        create: { stageId, userId: p.userId, rank: p.rank, rankLabel: p.rankLabel },
        update: { rank: p.rank, rankLabel: p.rankLabel },
      }),
    ),
  )

  await prisma.tournamentStage.update({
    where: { id: stageId },
    data:  { status: 'finished', finishedAt: new Date() },
  })

  const allStages = stage.tournament.stages
  const nextStage = allStages.find(s => s.stageNumber === stage.stageNumber + 1)

  // ── Final stage — tournament over ──────────────────────────────────────────
  if (!nextStage) {
    await prisma.tournament.update({
      where: { id: stage.tournamentId },
      data:  { status: 'finished', finishedAt: new Date() },
    })
    await distributePrizes(stage.tournamentId)
    log.info({ tournamentId: stage.tournamentId }, 'tournament finished — prizes distributed')
    return
  }

  // ── Eliminate players who didn't advance ───────────────────────────────────
  const advanceCount = stage.advanceCount ?? placements.length
  const toEliminate  = placements.filter(p => p.rank > advanceCount)

  if (toEliminate.length > 0) {
    await prisma.tournamentPlayer.updateMany({
      where: {
        tournamentId: stage.tournamentId,
        userId:       { in: toEliminate.map(e => e.userId) },
      },
      data: { eliminated: true },
    })
  }

  // ── Schedule next stage ────────────────────────────────────────────────────
  const delay = nextStage.startTimeType === 'fixed' && nextStage.fixedStartAt
    ? Math.max(0, nextStage.fixedStartAt.getTime() - Date.now())
    : (nextStage.relativeBreakMinutes ?? 0) * 60_000

  await tournamentQueue.add(
    'tournament',
    { type: 'stage-start', stageId: nextStage.id },
    { delay },
  )

  log.info(
    { stageId, nextStageId: nextStage.id, eliminatedCount: toEliminate.length, delay },
    'stage finished — next stage scheduled',
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActivePlayerIds(tournamentId: number): Promise<number[]> {
  const players = await prisma.tournamentPlayer.findMany({
    where:   { tournamentId, eliminated: false },
    orderBy: { score: 'desc' },
  })
  return players.map(p => p.userId)
}

async function getLastUpdatedDraft(userId: number, mode: GameMode): Promise<number | null> {
  const draft = await prisma.draft.findFirst({
    where:   { userId, mode },
    orderBy: { updatedAt: 'desc' },
    select:  { id: true },
  })
  return draft?.id ?? null
}

function isEliminationFinal(games: { isBye: boolean }[]): boolean {
  // Final round has exactly one real (non-BYE) game
  return games.filter(g => !g.isBye).length === 1
}

// ─── Create live game ─────────────────────────────────────────────────────────
// Creates a Game row, seeds Redis state, notifies both players.
// ELO-neutral: stores EloBefore for display only — finalizeGame is bypassed.

async function createLiveGame(
  tGame: {
    id:            number
    player1Id:     number
    player2Id:     number
    player1DraftId: number
    player2DraftId: number
  },
  tournament: { id: number; mode: string | null },
  mode:       GameMode,
  auxPoints:  number,
  publisher:  RedisClientType,
): Promise<void> {
  const isP1White = Math.random() > 0.5
  const whiteId   = isP1White ? tGame.player1Id : tGame.player2Id
  const wDraftId  = isP1White ? tGame.player1DraftId : tGame.player2DraftId
  const bDraftId  = isP1White ? tGame.player2DraftId : tGame.player1DraftId

  const [wDraft, bDraft, p1Stats, p2Stats] = await Promise.all([
    prisma.draft.findUnique({ where: { id: wDraftId }, select: { fen: true } }),
    prisma.draft.findUnique({ where: { id: bDraftId }, select: { fen: true } }),
    prisma.user.findUnique({
      where:  { id: tGame.player1Id },
      select: {
        eloStandard: true, eloPauper: true, eloRoyal: true,
        gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      },
    }),
    prisma.user.findUnique({
      where:  { id: tGame.player2Id },
      select: {
        eloStandard: true, eloPauper: true, eloRoyal: true,
        gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      },
    }),
  ])

  const eloField   = mode === 'standard' ? 'eloStandard'        : mode === 'pauper' ? 'eloPauper'        : 'eloRoyal'
  const gamesField = mode === 'standard' ? 'gamesPlayedStandard' : mode === 'pauper' ? 'gamesPlayedPauper' : 'gamesPlayedRoyal'
  const p1Elo      = p1Stats?.[eloField]   ?? 1200
  const p2Elo      = p2Stats?.[eloField]   ?? 1200
  const p1Games    = p1Stats?.[gamesField] ?? 0
  const p2Games    = p2Stats?.[gamesField] ?? 0

  const fen = wDraft && bDraft
    ? buildCombinedDraftFen(wDraft.fen, bDraft.fen)
    : '8/8/8/8/8/8/8/4K3 w - - 0 1' // fallback (should not occur)

  const now  = new Date()

  const game = await prisma.game.create({
    data: {
      player1Id:        tGame.player1Id,
      player2Id:        tGame.player2Id,
      whitePlayerId:    whiteId,
      mode,
      status:           'prep',
      prepStartedAt:    now,
      isFriendGame:     false,
      draft1Id:         isP1White ? wDraftId : bDraftId,
      draft2Id:         isP1White ? bDraftId : wDraftId,
      fen,
      auxPointsPlayer1: auxPoints,
      auxPointsPlayer2: auxPoints,
      player1Timebank:  60_000,
      player2Timebank:  60_000,
      // ELO-neutral: stored for post-game display only, never updated
      player1EloBefore: p1Elo,
      player2EloBefore: p2Elo,
      tournamentId:     tournament.id,
      tournamentRoundId: tGame.id,
    },
  })

  await prisma.tournamentGame.update({
    where: { id: tGame.id },
    data:  { gameId: game.id },
  })

  await seedGameState(publisher, {
    gameId:              game.id,
    player1Id:           tGame.player1Id,
    player2Id:           tGame.player2Id,
    whitePlayerId:       whiteId,
    mode,
    isFriendGame:        false,
    fen,
    prepStartedAt:       now.getTime(),
    auxPointsPlayer1:    auxPoints,
    auxPointsPlayer2:    auxPoints,
    player1Timebank:     60_000,
    player2Timebank:     60_000,
    draft1Fen:           wDraft?.fen ?? '',
    draft2Fen:           bDraft?.fen ?? '',
    player1EloBefore:    p1Elo,
    player2EloBefore:    p2Elo,
    player1GamesPlayed:  p1Games,
    player2GamesPlayed:  p2Games,
  })

  // Notify both players — redirect to the game
  for (const userId of [tGame.player1Id, tGame.player2Id]) {
    await publisher.publish('draftchess:game-events', JSON.stringify({
      type:    'queue-user',
      userId,
      event:   'tournament-game-ready',
      payload: { gameId: game.id, tournamentId: tournament.id },
    }))
  }

  log.info({ gameId: game.id, tGameId: tGame.id }, 'live tournament game created')
}
