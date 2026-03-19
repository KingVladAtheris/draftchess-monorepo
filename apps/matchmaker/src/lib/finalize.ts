// apps/matchmaker/src/lib/finalize.ts
//
// Single source of truth for all game finalization.
// Called by: timeout worker, forfeit subscriber, reconcile worker,
//            game-ended subscriber (new — replaces web app's updateGameResult).
//
// Writes ELO, stats, and game outcome to Postgres.
// Deletes the Redis game hash after persisting.
// Never called from the web app — the web app publishes to
// draftchess:game-ended and this module handles it.

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

  // ── Friend games ─────────────────────────────────────────────────────────────
  // Mark finished and clear queue state, but skip ELO / stat updates entirely.
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
    const r = calculateEloChange(p1EloBefore, p2EloBefore, p1Games, true)
    p1Change = r.winnerChange
    p2Change = r.loserChange
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
      // Optimistic concurrency guard — only finishes a game that is still active.
      // If another code path already finished it, count === 0 and we bail.
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
    // Delete Redis hash now that Postgres has the final state
    await deleteGameState(redis, gameId)
    log.info(
      { gameId, mode, endReason, newP1Elo, newP2Elo, eloChange },
      'game finalized',
    )
  }

  return finalized ? { newP1Elo, newP2Elo, eloChange } : null
}
