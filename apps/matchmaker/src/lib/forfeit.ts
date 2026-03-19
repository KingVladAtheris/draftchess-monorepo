// apps/matchmaker/src/lib/forfeit.ts
//
// Handles player forfeit when their presence grace period expires.
// Called by the forfeit subscriber when the socket server publishes
// to draftchess:forfeit after a player disconnects and doesn't reconnect.
//
// Reads game state from Redis (fast path) with Postgres fallback via
// loadGameState. Passes publisher to finalizeGame for Redis cleanup.

import { prisma }            from '@draftchess/db'
import { type GameMode }     from '@draftchess/shared/game-modes'
import { loadGameState }     from '@draftchess/game-state'
import { finalizeGame }      from './finalize.js'
import { publishGameUpdate } from './notify.js'
import { cancelTimeoutJob }  from '../queues.js'
import { logger }            from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:forfeit' })

export async function forfeitGame(
  gameId:    number,
  userId:    number,
  publisher: RedisClientType,
): Promise<void> {

  // Load game state — Redis first, Postgres fallback
  const state = await loadGameState(publisher, gameId)

  if (!state) {
    log.warn({ gameId }, 'game not found in Redis or Postgres')
    return
  }

  if (state === 'finished') {
    log.info({ gameId }, 'game already finished — skipping forfeit')
    return
  }

  if (state.status !== 'active' && state.status !== 'prep') {
    log.info({ gameId, status: state.status }, 'game not active or prep — skipping forfeit')
    return
  }

  const isPlayer1 = state.player1Id === userId
  if (!isPlayer1 && state.player2Id !== userId) {
    log.warn({ gameId, userId }, 'user is not a participant in game')
    return
  }

  // For prep games, promote to active so finalizeGame's Postgres guard can fire.
  // updateMany is atomic — if the ready route already resolved prep, count=0 and we bail.
  if (state.status === 'prep') {
    const promoted = await prisma.game.updateMany({
      where: { id: gameId, status: 'prep' },
      data:  { status: 'active' },
    })
    if (promoted.count === 0) {
      log.info({ gameId }, 'prep already resolved by another path — skipping forfeit')
      return
    }
  }

  const winnerId = isPlayer1 ? state.player2Id : state.player1Id

  // cancelTimeoutJob is idempotent — always call it so we never leave
  // an orphaned BullMQ job regardless of what finalizeGame returns.
  await cancelTimeoutJob(gameId)

  const result = await finalizeGame(
    gameId,
    winnerId,
    state.player1Id,
    state.player2Id,
    state.player1EloBefore,
    state.player2EloBefore,
    state.player1GamesPlayed,
    state.player2GamesPlayed,
    'abandoned',
    (state.mode ?? 'standard') as GameMode,
    state.isFriendGame,
    publisher,
  )

  if (!result) {
    log.info({ gameId }, 'game already finished by another path — skipping forfeit')
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

  log.info({ gameId, userId, winnerId }, 'forfeit processed')
}