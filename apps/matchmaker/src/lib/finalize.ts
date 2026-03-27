// apps/matchmaker/src/lib/finalize.ts
//
// CHANGE: Draw ELO calculation now uses each player's own game count for
// their K-factor instead of always using p1Games for both sides.
// Previously: calculateEloChange(p1Elo, p2Elo, p1Games, true) was called
// for draws, which used player1's game count to determine player2's K-factor.
// Now each player's change is calculated independently using their own count.

import { Prisma, prisma }              from '@draftchess/db'
import { calculateEloChange, MIN_ELO } from '@draftchess/shared/elo'
import {
  type GameMode,
  ELO_FIELD,
  GAMES_PLAYED_FIELD,
  WINS_FIELD,
  LOSSES_FIELD,
  DRAWS_FIELD,
} from '@draftchess/shared/game-modes'
import { deleteGameState }             from '@draftchess/game-state'
import { logger }                      from '@draftchess/logger'
import type { RedisClientType }        from 'redis'

const log = logger.child({ module: 'matchmaker:finalize' })

export interface FinalizeResult {
  newP1Elo:  number
  newP2Elo:  number
  eloChange: number
}

export async function finalizeGame(
  gameId:      number,
  winnerId:    number | null,
  player1Id:   number,
  player2Id:   number,
  p1EloBefore: number,
  p2EloBefore: number,
  p1Games:     number,
  p2Games:     number,
  endReason:   string,
  mode:        GameMode = 'standard',
  isFriendGame = false,
  redis:       RedisClientType,
): Promise<FinalizeResult | null> {

  const gameRow = await prisma.game.findUnique({
    where:  { id: gameId },
    select: { tournamentId: true, player1EloBefore: true, player2EloBefore: true },
  })

  if (gameRow?.tournamentId) {
    let finalized = false

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Idempotency guard — only finalize once
      const guard = await tx.game.updateMany({
        where: { id: gameId, status: 'active' },
        data:  { status: 'finished', winnerId: winnerId ?? undefined, endReason },
      })
      if (guard.count === 0) return

      const queueReset = {
        queueStatus:   'offline',
        queuedAt:      null,
        queuedDraftId: null,
        queuedMode:    null,
      }
      await tx.user.update({ where: { id: player1Id }, data: queueReset })
      await tx.user.update({ where: { id: player2Id }, data: queueReset })

      finalized = true
    })

    if (finalized) {
      await deleteGameState(redis, gameId)
    }

    // Return a neutral result — caller (game-ended-subscriber) reads these
    // values but they will not be written to the ELO columns
    return finalized
      ? {
          newP1Elo:  gameRow.player1EloBefore ?? 1200,
          newP2Elo:  gameRow.player2EloBefore ?? 1200,
          eloChange: 0,
        }
      : null
  }

  // ── Friend games ─────────────────────────────────────────────────────────────
  if (isFriendGame) {
    let finalized = false
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const guard = await tx.game.updateMany({
          where: { id: gameId, status: 'active' },
          data:  { status: 'finished' },
        })
        if (guard.count === 0) return
        await tx.game.update({
          where: { id: gameId },
          data:  { winnerId: winnerId ?? undefined, endReason },
        })
        const queueReset = { queueStatus: 'offline', queuedAt: null, queuedDraftId: null, queuedMode: null }
        await tx.user.update({ where: { id: player1Id }, data: queueReset })
        await tx.user.update({ where: { id: player2Id }, data: queueReset })
        finalized = true
      })
    } catch (err: any) {
      log.error({ gameId, err: err.message }, 'friend game transaction error')
      throw err
    }

    if (finalized) {
      await deleteGameState(redis, gameId)
      log.info({ gameId, endReason }, 'friend game finalized')
    }

    return finalized
      ? { newP1Elo: p1EloBefore, newP2Elo: p2EloBefore, eloChange: 0 }
      : null
  }

  // ── ELO calculation ──────────────────────────────────────────────────────────
  const isDraw = winnerId === null
  let p1Change: number
  let p2Change: number

  if (isDraw) {
    // FIX: use each player's own game count for their K-factor.
    // Previously both sides used p1Games, giving player2 the wrong K-factor.
    // For draws we calculate each player's change from their own perspective:
    //   - treat each player as the "winner" with score 0.5
    //   - calculateEloChange with isDraw=true returns symmetric-ish changes
    //   - but K-factor must come from the player whose change we're computing
    const r1 = calculateEloChange(p1EloBefore, p2EloBefore, p1Games, true)
    const r2 = calculateEloChange(p2EloBefore, p1EloBefore, p2Games, true)
    p1Change = r1.winnerChange  // p1's change (K based on p1Games)
    p2Change = r2.winnerChange  // p2's change (K based on p2Games)
  } else if (winnerId === player1Id) {
    const r = calculateEloChange(p1EloBefore, p2EloBefore, p1Games, false)
    p1Change = r.winnerChange
    p2Change = r.loserChange
  } else {
    const r = calculateEloChange(p2EloBefore, p1EloBefore, p2Games, false)
    p2Change = r.winnerChange
    p1Change = r.loserChange
  }

  const newP1Elo  = Math.max(MIN_ELO, p1EloBefore + p1Change)
  const newP2Elo  = Math.max(MIN_ELO, p2EloBefore + p2Change)
  const eloChange = Math.abs(p1Change)

  // ── Persist ──────────────────────────────────────────────────────────────────
  const eloF    = ELO_FIELD[mode]
  const gamesF  = GAMES_PLAYED_FIELD[mode]
  const winsF   = WINS_FIELD[mode]
  const lossesF = LOSSES_FIELD[mode]
  const drawsF  = DRAWS_FIELD[mode]
  const queueReset = { queueStatus: 'offline', queuedAt: null, queuedDraftId: null, queuedMode: null }

  let finalized = false

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const guard = await tx.game.updateMany({
        where: { id: gameId, status: 'active' },
        data:  { status: 'finished' },
      })
      if (guard.count === 0) return

      await tx.game.update({
        where: { id: gameId },
        data: {
          winnerId:        winnerId ?? undefined,
          player1EloAfter: newP1Elo,
          player2EloAfter: newP2Elo,
          eloChange,
          endReason,
        },
      })

      await tx.user.update({
        where: { id: player1Id },
        data: {
          [eloF]:   newP1Elo,
          [gamesF]: { increment: 1 },
          ...(!isDraw && winnerId === player1Id ? { [winsF]:   { increment: 1 } } : {}),
          ...(!isDraw && winnerId !== player1Id ? { [lossesF]: { increment: 1 } } : {}),
          ...(isDraw                            ? { [drawsF]:  { increment: 1 } } : {}),
          ...queueReset,
        },
      })

      await tx.user.update({
        where: { id: player2Id },
        data: {
          [eloF]:   newP2Elo,
          [gamesF]: { increment: 1 },
          ...(!isDraw && winnerId === player2Id ? { [winsF]:   { increment: 1 } } : {}),
          ...(!isDraw && winnerId !== player2Id ? { [lossesF]: { increment: 1 } } : {}),
          ...(isDraw                            ? { [drawsF]:  { increment: 1 } } : {}),
          ...queueReset,
        },
      })

      finalized = true
    })
  } catch (err: any) {
    log.error({ gameId, err: err.message }, 'finalize transaction error')
    throw err
  }

  if (finalized) {
    await deleteGameState(redis, gameId)

    // Clear the matched:{userId} keys written by the match worker.
    // These keys drive the queue/status fast path — if left alive they
    // redirect both players back to this finished game for up to 5 minutes.
    await Promise.all([
      redis.del(`matched:${player1Id}`),
      redis.del(`matched:${player2Id}`),
    ]).catch((err: any) => {
      log.warn({ gameId, err: err.message }, 'failed to clear matched keys — will expire naturally')
    })

    log.info(
      { gameId, mode, endReason, newP1Elo, newP2Elo, eloChange },
      'game finalized',
    )
  }

  return finalized ? { newP1Elo, newP2Elo, eloChange } : null
}