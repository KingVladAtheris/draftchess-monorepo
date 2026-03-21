// packages/game-state/src/client.ts
//
// All Redis operations on the game:{id} hash.
// This is the only file that issues Redis commands against game state.
// Every consumer imports from here — nobody writes raw Redis hash commands.
//
// The RedisClientType passed in is the connected redis client from the
// calling process. We don't create our own connection here — each process
// (web, socket-server, matchmaker) manages its own Redis client and passes
// it in. This avoids hidden connection proliferation.

import type { RedisClientType } from 'redis'
import {
  deserialize,
  serializeSeed,
  serializeUpdate,
} from './serialization'
import {
  MOVE_SCRIPT,
  PLACE_SCRIPT,
  READY_SCRIPT,
  DRAW_OFFER_SCRIPT,
  FINISH_SCRIPT,
} from './lua'
import type {
  GameState,
  SeedGameStatePayload,
  UpdateGameStatePayload,
  LuaMoveResult,
  LuaPlaceResult,
  LuaReadyResult,
} from './types'

// ── Key helpers ───────────────────────────────────────────────────────────────

export function gameKey(gameId: number): string {
  return `game:${gameId}`
}

// TTL for active game hashes.
// 4 hours covers the longest possible game plus prep time.
// The matchmaker DELs the key explicitly on finalization —
// this TTL is a safety net for games that fall through cleanup.
const GAME_TTL_SECONDS = 4 * 60 * 60

// ── Seed ─────────────────────────────────────────────────────────────────────

/**
 * Write the initial game hash to Redis.
 * Called by the matchmaker immediately after creating the Game row in Postgres.
 * Sets a 4-hour TTL as a safety net.
 */
export async function seedGameState(
  redis: RedisClientType,
  payload: SeedGameStatePayload,
): Promise<void> {
  const key    = gameKey(payload.gameId)
  const fields = serializeSeed(payload)

  // HSET with multiple field/value pairs in one call
  await (redis as any).hSet(key, fields)
  await redis.expire(key, GAME_TTL_SECONDS)
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the full game state from Redis.
 * Returns null if the key does not exist (game not in Redis).
 * Callers must handle null via the fallback path in fallback.ts.
 */
export async function getGameState(
  redis: RedisClientType,
  gameId: number,
): Promise<GameState | null> {
  const raw = await redis.hGetAll(gameKey(gameId))

  // hGetAll returns {} for a missing key, not null
  if (!raw || Object.keys(raw).length === 0) return null

  return deserialize(raw)
}

/**
 * Read a single field from the game hash.
 * Useful for lightweight checks (e.g. status only) without loading the full hash.
 */
export async function getGameField(
  redis: RedisClientType,
  gameId: number,
  field: keyof GameState,
): Promise<string | null> {
  const val = await redis.hGet(gameKey(gameId), field)
  return val ?? null
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Partially update the game hash.
 * Only fields present in the payload are written.
 * Not atomic with respect to reads — use Lua scripts for operations
 * that require read-modify-write atomicity.
 */
export async function updateGameState(
  redis: RedisClientType,
  gameId: number,
  update: UpdateGameStatePayload,
): Promise<void> {
  const pairs = serializeUpdate(update)
  if (pairs.length === 0) return
  await (redis as any).hSet(gameKey(gameId), pairs)
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete the game hash from Redis.
 * Called by the matchmaker after writing the final game state to Postgres.
 */
export async function deleteGameState(
  redis: RedisClientType,
  gameId: number,
): Promise<void> {
  await redis.del(gameKey(gameId))
}

// ── Lua: move ─────────────────────────────────────────────────────────────────

/**
 * Atomically update game state after a valid move.
 * Validates the game is still active before writing.
 */
export async function applyMove(
  redis: RedisClientType,
  gameId:          number,
  fen:             string,
  moveNumber:      number,
  lastMoveAt:      number,  // Unix ms
  lastMoveBy:      number,  // userId
  player1Timebank: number,
  player2Timebank: number,
): Promise<LuaMoveResult> {
  const result = await redis.eval(MOVE_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [
      fen,
      String(moveNumber),
      String(lastMoveAt),
      String(lastMoveBy),
      String(player1Timebank),
      String(player2Timebank),
    ],
  }) as number

  if (result === 1) return { ok: true }
  return { ok: false, reason: 'not_active' }
}

// ── Lua: place ────────────────────────────────────────────────────────────────

/**
 * Atomically place an aux piece during prep.
 * Checks points, updates FEN and decrements aux points in one operation.
 *
 * pointsField: 'auxPointsPlayer1' or 'auxPointsPlayer2'
 */
export async function placePiece(
  redis: RedisClientType,
  gameId:      number,
  pointsField: 'auxPointsPlayer1' | 'auxPointsPlayer2',
  cost:        number,
  newFen:      string,
): Promise<LuaPlaceResult> {
  const result = await redis.eval(PLACE_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [pointsField, String(cost), newFen],
  }) as number

  if (result >= 0) return { ok: true, newAuxPoints: result }
  if (result === -1) return { ok: false, reason: 'not_prep' }
  if (result === -2) return { ok: false, reason: 'insufficient_points' }
  return { ok: false, reason: 'insufficient_points' }
}

// ── Lua: ready ────────────────────────────────────────────────────────────────

/**
 * Atomically mark a player ready.
 * If both players are ready, transitions the game to active.
 * Returns bothReady: true if the game just transitioned — caller should
 * publish to draftchess:game-started.
 *
 * isPlayer1: true if the player calling ready is player1
 */
export async function markReady(
  redis: RedisClientType,
  gameId:          number,
  isPlayer1:       boolean,
  now:             number,  // Unix ms
  player1Timebank: number,
  player2Timebank: number,
): Promise<LuaReadyResult> {
  const myField  = isPlayer1 ? 'readyPlayer1' : 'readyPlayer2'
  const oppField = isPlayer1 ? 'readyPlayer2' : 'readyPlayer1'

  const result = await redis.eval(READY_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [
      myField,
      oppField,
      String(now),
      String(player1Timebank),
      String(player2Timebank),
    ],
  }) as number

  if (result === 2)  return { ok: true,  bothReady: true  }
  if (result === 1)  return { ok: true,  bothReady: false }
  if (result === 0)  return { ok: false, reason: 'not_prep' }
  if (result === -1) return { ok: false, reason: 'already_ready' }
  return { ok: false, reason: 'not_prep' }
}

// ── Lua: draw offer ───────────────────────────────────────────────────────────

/**
 * Set or clear the draw offer on the game hash.
 * userId: the player making the offer. Pass 0 to clear.
 */
export async function setDrawOffer(
  redis: RedisClientType,
  gameId: number,
  userId: number,
): Promise<boolean> {
  const result = await redis.eval(DRAW_OFFER_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [String(userId)],
  }) as number
  return result === 1
}

// ── Lua: finish ───────────────────────────────────────────────────────────────

/**
 * Atomically transition the game to finished.
 * Returns true if this call made the transition (i.e. game was active).
 * Returns false if the game was already finished or not active —
 * another path got there first, no action needed.
 *
 * Called by the move route when it detects a terminal position,
 * before publishing to draftchess:game-ended.
 */
export async function markGameFinished(
  redis: RedisClientType,
  gameId: number,
): Promise<boolean> {
  const result = await redis.eval(FINISH_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [],
  }) as number
  return result === 1
}

// ── Exists check ──────────────────────────────────────────────────────────────

/**
 * Check if a game hash exists in Redis without loading it.
 * Useful for cold start detection before doing a full hGetAll.
 */
export async function gameExists(
  redis: RedisClientType,
  gameId: number,
): Promise<boolean> {
  const exists = await redis.exists(gameKey(gameId))
  return exists === 1
}
