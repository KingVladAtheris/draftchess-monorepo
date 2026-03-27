// packages/tournament-engine/src/index.ts
//
// Pure tournament logic: pairing, scoring, placements, prize distribution.
// Stateless — reads Postgres, returns data. No Redis, no BullMQ.
// The matchmaker workers call these functions.
//
// Scoring:  WIN = 2pts, DRAW = 1pt, LOSS = 0pts
// Tiebreak: buchholz (sum of opponents' scores), recalculated after each game

import { prisma } from '@draftchess/db'
import { logger } from '@draftchess/logger'

const log = logger.child({ module: 'tournament-engine' })

// ─── Types ────────────────────────────────────────────────────────────────────

export type Pairing = {
  player1Id: number
  player2Id: number  // -1 means BYE
}

export type PlacementResult = {
  userId:    number
  rank:      number
  rankLabel: string | null  // null = individual (top-4), "5–8" = grouped
}

// ─── Swiss pairing ────────────────────────────────────────────────────────────
// Greedy fold-down on score desc / buchholz desc.
// Avoids rematches within the same stage. Falls back to rematch if no other
// option (e.g. small player count late in a swiss).

export async function pairSwissRound(stageId: number): Promise<Pairing[]> {
  const stage = await prisma.tournamentStage.findUnique({
    where:   { id: stageId },
    include: {
      tournament: {
        include: {
          players: {
            where:   { eliminated: false },
            orderBy: [{ score: 'desc' }, { buchholz: 'desc' }],
          },
        },
      },
      rounds: {
        include: { games: { where: { isBye: false } } },
      },
    },
  })

  if (!stage) throw new Error(`Stage ${stageId} not found`)

  // Build set of already-played pairs within this stage
  const played = new Set<string>()
  for (const round of stage.rounds) {
    for (const g of round.games) {
      played.add([g.player1Id, g.player2Id].sort().join(':'))
    }
  }

  const queue  = stage.tournament.players.map(p => p.userId)
  const pairs: Pairing[] = []

  while (queue.length >= 2) {
    const p1    = queue.shift()!
    let matched = false

    for (let i = 0; i < queue.length; i++) {
      const key = [p1, queue[i]!].sort().join(':')
      if (!played.has(key)) {
        pairs.push({ player1Id: p1, player2Id: queue.splice(i, 1)[0]! })
        matched = true
        break
      }
    }

    // No rematch-free partner — take the next available player
    if (!matched && queue.length > 0) {
      pairs.push({ player1Id: p1, player2Id: queue.shift()! })
    }
  }

  // BYE for the remaining odd player (naturally the lowest-ranked at this point)
  if (queue.length === 1) {
    pairs.push({ player1Id: queue[0]!, player2Id: -1 })
  }

  return pairs
}

// ─── Single elimination pairing ───────────────────────────────────────────────

export async function pairEliminationRound(
  stageId:     number,
  roundNumber: number,
): Promise<Pairing[]> {
  const stage = await prisma.tournamentStage.findUnique({
    where:  { id: stageId },
    select: { tournamentId: true },
  })
  if (!stage) throw new Error(`Stage ${stageId} not found`)

  if (roundNumber === 1) {
    // Seed by score desc — 1st plays last, 2nd plays second-to-last, etc.
    const players = await prisma.tournamentPlayer.findMany({
      where:   { tournamentId: stage.tournamentId, eliminated: false },
      orderBy: { score: 'desc' },
    })

    const ids   = players.map(p => p.userId)
    const pairs: Pairing[] = []
    let lo = 0, hi = ids.length - 1

    while (lo < hi) {
      pairs.push({ player1Id: ids[lo++]!, player2Id: ids[hi--]! })
    }
    // Odd player out gets BYE
    if (lo === hi) pairs.push({ player1Id: ids[lo]!, player2Id: -1 })

    return pairs
  }

  // Subsequent rounds: winners of the previous round, in bracket order
  const prevRound = await prisma.tournamentRound.findUnique({
    where:   { stageId_roundNumber: { stageId, roundNumber: roundNumber - 1 } },
    include: { games: { orderBy: { id: 'asc' } } },
  })
  if (!prevRound) throw new Error(`Round ${roundNumber - 1} of stage ${stageId} not found`)

  const winners: number[] = []
  for (const g of prevRound.games) {
    if      (g.isBye)      winners.push(g.player1Id)
    else if (g.winnerId)   winners.push(g.winnerId)
  }

  const pairs: Pairing[] = []
  for (let i = 0; i + 1 < winners.length; i += 2) {
    pairs.push({ player1Id: winners[i]!, player2Id: winners[i + 1]! })
  }
  if (winners.length % 2 === 1) {
    pairs.push({ player1Id: winners[winners.length - 1]!, player2Id: -1 })
  }

  return pairs
}

// ─── Round robin schedule ─────────────────────────────────────────────────────
// Berger construction — returns all rounds' pairings at once.
// Call once when the stage starts. Worker creates all TournamentRound +
// TournamentGame rows up front, then opens pick windows round by round.

export function buildRoundRobinSchedule(playerIds: number[]): Pairing[][] {
  // Pad to even count with -1 (BYE placeholder)
  const players = playerIds.length % 2 === 0
    ? [...playerIds]
    : [...playerIds, -1]

  const n      = players.length
  const rounds: Pairing[][] = []

  for (let r = 0; r < n - 1; r++) {
    const round: Pairing[] = []

    for (let i = 0; i < n / 2; i++) {
      const p1 = players[i]!
      const p2 = players[n - 1 - i]!

      if (p1 === -1 || p2 === -1) {
        const real = p1 === -1 ? p2 : p1
        if (real !== -1) round.push({ player1Id: real, player2Id: -1 })
      } else {
        round.push({ player1Id: p1, player2Id: p2 })
      }
    }

    rounds.push(round)
    // Rotate: keep index 0 fixed, rotate the rest clockwise
    players.splice(1, 0, players.pop()!)
  }

  return rounds
}

// ─── Record game result ───────────────────────────────────────────────────────
// Called by game-ended-subscriber after a live Game finishes.
// Mirrors the result onto TournamentGame, increments scores, recalculates buchholz.

export async function recordTournamentGameResult(opts: {
  tournamentGameId: number
  winnerId:         number | null
  isDraw:           boolean
}): Promise<void> {
  const { tournamentGameId, winnerId, isDraw } = opts

  await prisma.tournamentGame.update({
    where: { id: tournamentGameId },
    data:  { winnerId: winnerId ?? null, isDraw },
  })

  const tg = await prisma.tournamentGame.findUnique({
    where:   { id: tournamentGameId },
    include: { round: { include: { stage: true } } },
  })
  if (!tg) return

  const tournamentId = tg.round.stage.tournamentId

  if (isDraw) {
    await prisma.tournamentPlayer.updateMany({
      where: { tournamentId, userId: { in: [tg.player1Id, tg.player2Id] } },
      data:  { score: { increment: 1 } },
    })
  } else if (winnerId) {
    await prisma.tournamentPlayer.updateMany({
      where: { tournamentId, userId: winnerId },
      data:  { score: { increment: 2 } },
    })
  }

  // Recalculate buchholz for both players
  await updateBuchholz(tournamentId, tg.player1Id)
  await updateBuchholz(tournamentId, tg.player2Id)

  log.info({ tournamentGameId, winnerId, isDraw }, 'tournament game result recorded')
}

async function updateBuchholz(tournamentId: number, userId: number): Promise<void> {
  const games = await prisma.tournamentGame.findMany({
    where: {
      isBye: false,
      OR:    [{ player1Id: userId }, { player2Id: userId }],
      round: { stage: { tournamentId } },
    },
  })

  const oppIds = games.map(g =>
    g.player1Id === userId ? g.player2Id : g.player1Id,
  )
  if (oppIds.length === 0) return

  const opponents = await prisma.tournamentPlayer.findMany({
    where:  { tournamentId, userId: { in: oppIds } },
    select: { score: true },
  })

  const buchholz = opponents.reduce((sum, o) => sum + o.score, 0)

  await prisma.tournamentPlayer.updateMany({
    where: { tournamentId, userId },
    data:  { buchholz },
  })
}

// ─── Compute placements ───────────────────────────────────────────────────────
// Called when a stage finishes. Orders players by score desc, buchholz desc.
// Top 4 get individual ranks. Beyond that: grouped labels ("5–8").

export async function computePlacements(stageId: number): Promise<PlacementResult[]> {
  const stage = await prisma.tournamentStage.findUnique({
    where:   { id: stageId },
    include: {
      tournament: {
        include: {
          players: {
            orderBy: [{ score: 'desc' }, { buchholz: 'desc' }],
          },
        },
      },
    },
  })
  if (!stage) return []

  const players  = stage.tournament.players
  const results: PlacementResult[] = []
  let rank       = 1

  while (rank <= players.length) {
    const pivot  = players[rank - 1]!
    let groupEnd = rank

    // Find all players tied at this rank
    while (
      groupEnd < players.length &&
      players[groupEnd]!.score    === pivot.score &&
      players[groupEnd]!.buchholz === pivot.buchholz
    ) {
      groupEnd++
    }

    const groupSize  = groupEnd - rank + 1
    const rankEndNum = rank + groupSize - 1

    for (let i = rank; i <= rankEndNum; i++) {
      const player = players[i - 1]!

      if (i <= 4) {
        // Individual placement for top 4
        results.push({ userId: player.userId, rank: i, rankLabel: null })
      } else {
        const label = groupSize > 1 ? `${rank}–${rankEndNum}` : `${rank}`
        results.push({ userId: player.userId, rank, rankLabel: label })
      }
    }

    rank = rankEndNum + 1
  }

  return results
}

// ─── Distribute prizes ────────────────────────────────────────────────────────
// Called after the final stage finishes. Grants token prizes via token-service.

export async function distributePrizes(tournamentId: number): Promise<void> {
  const [prizes, lastStage] = await Promise.all([
    prisma.tournamentPrize.findMany({ where: { tournamentId } }),
    prisma.tournamentStage.findFirst({
      where:   { tournament: { id: tournamentId } },
      orderBy: { stageNumber: 'desc' },
      include: { placements: true },
    }),
  ])

  if (!lastStage?.placements.length) {
    log.warn({ tournamentId }, 'distributePrizes: no placements found')
    return
  }

  // Dynamic import avoids a circular dependency at module load time
  const { grantToken } = await import('@draftchess/token-service')

  for (const prize of prizes) {
    if (prize.prizeType !== 'token' || !prize.tokenSlug) continue

    const recipients = lastStage.placements.filter(
      p => p.rank >= prize.rankFrom && p.rank <= prize.rankTo,
    )

    for (const placement of recipients) {
      await grantToken({
        userId:    placement.userId,
        tokenSlug: prize.tokenSlug,
        note:      `Tournament #${tournamentId} prize — rank ${placement.rankLabel ?? placement.rank}`,
      })
    }

    log.info(
      { tournamentId, tokenSlug: prize.tokenSlug, count: recipients.length },
      'prizes granted',
    )
  }
}
