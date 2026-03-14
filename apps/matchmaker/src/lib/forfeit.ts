// apps/matchmaker/src/lib/forfeit.ts
// Ported from apps/web/src/app/lib/forfeit.ts.
// Lives in the matchmaker because it needs to call finalizeGame() and
// cancel BullMQ timeout jobs — both of which live here.
// The socket server triggers it by publishing to draftchess:forfeit;
// the forfeit subscriber in this process receives that and calls forfeitGame().

import { prisma }            from '@draftchess/db'
import { type GameMode, GAMES_PLAYED_FIELD } from '@draftchess/shared/game-modes'
import { finalizeGame }      from './finalize.js'
import { publishGameUpdate } from './notify.js'
import { cancelTimeoutJob }  from '../queues.js'
import type { RedisClientType } from 'redis'

export async function forfeitGame(
  gameId:    number,
  userId:    number,
  publisher: RedisClientType,
): Promise<void> {

  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      status:           true,
      mode:             true,
      isFriendGame:     true,
      player1Id:        true,
      player2Id:        true,
      player1EloBefore: true,
      player2EloBefore: true,
      player1: {
        select: {
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      },
      player2: {
        select: {
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      },
    },
  })

  if (!game) {
    console.warn(`[forfeit] game ${gameId} not found`)
    return
  }

  if (game.status !== 'active' && game.status !== 'prep') {
    console.log(`[forfeit] game ${gameId} already finished (status: ${game.status}), skipping`)
    return
  }

  const isPlayer1 = game.player1Id === userId
  if (!isPlayer1 && game.player2Id !== userId) {
    console.warn(`[forfeit] user ${userId} is not a participant in game ${gameId}`)
    return
  }

  // For prep games, promote to active so finalizeGame's guard can fire.
  // updateMany is atomic — if the ready route already resolved prep, count=0 and we bail.
  if (game.status === 'prep') {
    const promoted = await prisma.game.updateMany({
      where: { id: gameId, status: 'prep' },
      data:  { status: 'active' },
    })
    if (promoted.count === 0) {
      console.log(`[forfeit] game ${gameId} prep already resolved, skipping`)
      return
    }
  }

  const winnerId   = isPlayer1 ? game.player2Id : game.player1Id
  const gameMode   = (game.mode ?? 'standard') as GameMode
  const gamesField = GAMES_PLAYED_FIELD[gameMode]

  // cancelTimeoutJob is idempotent — always call it so we never leave
  // an orphaned BullMQ job regardless of what finalizeGame returns.
  await cancelTimeoutJob(gameId)

  const result = await finalizeGame(
    gameId,
    winnerId,
    game.player1Id,
    game.player2Id,
    game.player1EloBefore ?? 1200,
    game.player2EloBefore ?? 1200,
    game.player1[gamesField] ?? 0,
    game.player2[gamesField] ?? 0,
    'abandoned',
    gameMode,
    game.isFriendGame === true,
  )

  if (!result) {
    // finalizeGame saw status !== 'active' — another path already finished the game.
    console.log(`[forfeit] game ${gameId} already finished by another path, skipping`)
    return
  }

  await publishGameUpdate(publisher, gameId, {
    status:          'finished',
    winnerId,
    endReason:       'abandoned',
    player1EloAfter: result.newP1Elo,
    player2EloAfter: result.newP2Elo,
    eloChange:       result.eloChange,
  })

  console.log(`[forfeit] game ${gameId}: user ${userId} forfeited, winner: ${winnerId}`)
}
