// packages/game-state/src/fallback.ts
//
// Cold start / Redis miss handler.
// Called by every consumer when getGameState() returns null.
//
// Flow:
//   1. Query Postgres for the game
//   2. If finished: return the finished state, do NOT seed Redis
//      (finished games are not cached — they're read from Postgres directly)
//   3. If active or prep: build the hash payload, seed Redis, return state
//   4. If not found: return null
//
// This function is the single implementation of the fallback path.
// Every consumer (move route, snapshot, timeout worker, reconcile worker)
// calls this — nobody duplicates the fallback logic.

import { prisma }               from '@draftchess/db'
import { GAMES_PLAYED_FIELD }   from '@draftchess/shared'
import type { GameMode }        from '@draftchess/shared'
import type { RedisClientType } from 'redis'
import { logger }               from '@draftchess/logger'

import { seedGameState, getGameState, updateGameState } from './client.js'
import type { GameState, SeedGameStatePayload }         from './types.js'

const log = logger.child({ module: 'game-state:fallback' })

/**
 * Load game state, falling back to Postgres if Redis misses.
 *
 * Returns:
 *   GameState  — game found and loaded (from Redis or reseeded from Postgres)
 *   null       — game not found anywhere
 *   'finished' — game is finished, not in Redis (use Postgres for final state)
 *
 * The 'finished' sentinel tells consumers not to process the game —
 * it's already done. Consumers should read the final state from Postgres
 * directly for display purposes (profile page, replay etc).
 */
export async function loadGameState(
  redis: RedisClientType,
  gameId: number,
): Promise<GameState | null | 'finished'> {
  // Fast path — Redis hit
  const cached = await getGameState(redis, gameId)
  if (cached !== null) {
    // If we somehow have a finished game in Redis, treat as finished
    if (cached.status === 'finished') return 'finished'
    return cached
  }

  // Slow path — Redis miss, query Postgres
  log.debug({ gameId }, 'Redis miss — loading from Postgres')

  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      id:              true,
      status:          true,
      mode:            true,
      isFriendGame:    true,
      fen:             true,
      player1Id:       true,
      player2Id:       true,
      whitePlayerId:   true,
      prepStartedAt:   true,
      readyPlayer1:    true,
      readyPlayer2:    true,
      auxPointsPlayer1: true,
      auxPointsPlayer2: true,
      player1Timebank:  true,
      player2Timebank:  true,
      lastMoveAt:      true,
      lastMoveBy:      true,
      moveNumber:      true,
      player1EloBefore: true,
      player2EloBefore: true,
      draft1: { select: { fen: true } },
      draft2: { select: { fen: true } },
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
    log.warn({ gameId }, 'game not found in Postgres or Redis')
    return null
  }

  // Finished games are not reseeded — callers read from Postgres directly
  if (game.status === 'finished') {
    log.debug({ gameId }, 'game is finished — not reseeding Redis')
    return 'finished'
  }

  const mode       = (game.mode ?? 'standard') as GameMode
  const gamesField = GAMES_PLAYED_FIELD[mode]

  const payload: SeedGameStatePayload = {
    gameId:        game.id,
    player1Id:     game.player1Id,
    player2Id:     game.player2Id,
    whitePlayerId: game.whitePlayerId,
    mode,
    isFriendGame:  game.isFriendGame,

    // If FEN is null (shouldn't happen but guard it), use a blank board
    fen: game.fen ?? '8/8/8/8/8/8/8/4K3 w - - 0 1',

    prepStartedAt:    game.prepStartedAt ? game.prepStartedAt.getTime() : 0,
    auxPointsPlayer1: game.auxPointsPlayer1,
    auxPointsPlayer2: game.auxPointsPlayer2,
    player1Timebank:  game.player1Timebank,
    player2Timebank:  game.player2Timebank,

    draft1Fen: game.draft1?.fen ?? '',
    draft2Fen: game.draft2?.fen ?? '',

    player1EloBefore:   game.player1EloBefore ?? 1200,
    player2EloBefore:   game.player2EloBefore ?? 1200,
    player1GamesPlayed: game.player1[gamesField] ?? 0,
    player2GamesPlayed: game.player2[gamesField] ?? 0,
  }

  // Seed Redis from Postgres
  await seedGameState(redis, payload)

  // If the game was already active (e.g. matchmaker restarted), we need to
  // also restore the move state that seedGameState initializes to zero.
  // seedGameState sets sane defaults but the game may have progressed.
  if (game.status === 'active' && game.lastMoveAt) {
    await updateGameState(redis, gameId, {
      status:     'active',
      lastMoveAt: game.lastMoveAt.getTime(),
      lastMoveBy: game.lastMoveBy ?? 0,
      moveNumber: game.moveNumber,
      readyPlayer1: game.readyPlayer1,
      readyPlayer2: game.readyPlayer2,
    })
  }

  // Read back what we just wrote so the caller gets a consistent object
  const reseeded = await getGameState(redis, gameId)

  if (!reseeded) {
    log.error({ gameId }, 'reseed failed — Redis write may have failed')
    return null
  }

  log.info({ gameId, status: game.status }, 'reseeded game from Postgres')
  return reseeded
}
