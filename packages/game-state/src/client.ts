// packages/game-state/src/client.ts
//
// CHANGES:
//   - offerDraw: enforces cooldown and duplicate-offer check via Lua
//   - declineDraw: atomically clears offer and records decline move number
//   - cancelDraw: lets the offerer withdraw their offer
//   - offerRematch: sets rematch state on a finished game
//   - cancelRematch: clears rematch state (navigation away / expiry)

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
  DRAW_DECLINE_SCRIPT,
  DRAW_CANCEL_SCRIPT,
  FINISH_SCRIPT,
  REMATCH_OFFER_SCRIPT,
  REMATCH_CANCEL_SCRIPT,
} from './lua'
import type {
  GameState,
  SeedGameStatePayload,
  UpdateGameStatePayload,
  LuaMoveResult,
  LuaPlaceResult,
  LuaReadyResult,
  LuaDrawOfferResult,
  LuaDrawDeclineResult,
  LuaRematchOfferResult,
} from './types'

export function gameKey(gameId: number): string {
  return `game:${gameId}`
}

const GAME_TTL_SECONDS = 4 * 60 * 60
const DRAW_COOLDOWN_MOVES = 3
const REMATCH_EXPIRY_MS   = 30_000

// ── Seed ──────────────────────────────────────────────────────────────────────

export async function seedGameState(
  redis: RedisClientType,
  payload: SeedGameStatePayload,
): Promise<void> {
  const key    = gameKey(payload.gameId)
  const fields = serializeSeed(payload)
  await (redis as any).hSet(key, fields)
  await redis.expire(key, GAME_TTL_SECONDS)
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getGameState(
  redis: RedisClientType,
  gameId: number,
): Promise<GameState | null> {
  const raw = await redis.hGetAll(gameKey(gameId))
  if (!raw || Object.keys(raw).length === 0) return null
  return deserialize(raw)
}

export async function getGameField(
  redis: RedisClientType,
  gameId: number,
  field: keyof GameState,
): Promise<string | null> {
  const val = await redis.hGet(gameKey(gameId), field)
  return val ?? null
}

// ── Update ────────────────────────────────────────────────────────────────────

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

export async function deleteGameState(
  redis: RedisClientType,
  gameId: number,
): Promise<void> {
  await redis.del(gameKey(gameId))
}

// ── Lua: move ─────────────────────────────────────────────────────────────────

export async function applyMove(
  redis: RedisClientType,
  gameId:          number,
  fen:             string,
  moveNumber:      number,
  lastMoveAt:      number,
  lastMoveBy:      number,
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
  return { ok: false, reason: 'insufficient_points' }
}

// ── Lua: ready ────────────────────────────────────────────────────────────────

export async function markReady(
  redis: RedisClientType,
  gameId:          number,
  isPlayer1:       boolean,
  now:             number,
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

export async function offerDraw(
  redis: RedisClientType,
  gameId:      number,
  userId:      number,
  moveNumber:  number,
): Promise<LuaDrawOfferResult> {
  const result = await redis.eval(DRAW_OFFER_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [
      String(userId),
      String(moveNumber),
      String(DRAW_COOLDOWN_MOVES),
    ],
  }) as number

  if (result === 1)  return { ok: true }
  if (result === 0)  return { ok: false, reason: 'not_active' }
  if (result === -1) return { ok: false, reason: 'cooldown' }
  if (result === -2) return { ok: false, reason: 'already_offered' }
  return { ok: false, reason: 'not_active' }
}

// ── Lua: draw decline ─────────────────────────────────────────────────────────

export async function declineDraw(
  redis: RedisClientType,
  gameId:     number,
  moveNumber: number,
): Promise<LuaDrawDeclineResult> {
  const result = await redis.eval(DRAW_DECLINE_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [
      '0', // userId not needed — any non-offerer can decline
      String(moveNumber),
    ],
  }) as number

  if (result === 1)  return { ok: true }
  if (result === 0)  return { ok: false, reason: 'not_active' }
  if (result === -1) return { ok: false, reason: 'no_offer' }
  return { ok: false, reason: 'not_active' }
}

// ── Lua: draw cancel ──────────────────────────────────────────────────────────

export async function cancelDraw(
  redis: RedisClientType,
  gameId: number,
  userId: number,
): Promise<boolean> {
  const result = await redis.eval(DRAW_CANCEL_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [String(userId)],
  }) as number
  return result === 1
}

// ── Lua: finish ───────────────────────────────────────────────────────────────

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

// ── Lua: rematch offer ────────────────────────────────────────────────────────

export async function offerRematch(
  redis: RedisClientType,
  gameId: number,
  userId: number,
): Promise<LuaRematchOfferResult> {
  const now    = Date.now()
  const result = await redis.eval(REMATCH_OFFER_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [String(userId), String(now)],
  }) as number

  if (result === 1)  return { ok: true }
  if (result === 0)  return { ok: false, reason: 'not_finished' }
  if (result === -1) return { ok: false, reason: 'already_offered' }
  return { ok: false, reason: 'not_finished' }
}

// ── Lua: rematch cancel ───────────────────────────────────────────────────────

export async function cancelRematch(
  redis: RedisClientType,
  gameId: number,
): Promise<boolean> {
  const result = await redis.eval(REMATCH_CANCEL_SCRIPT, {
    keys: [gameKey(gameId)],
    arguments: [],
  }) as number
  return result === 1
}

// ── Exists check ──────────────────────────────────────────────────────────────

export async function gameExists(
  redis: RedisClientType,
  gameId: number,
): Promise<boolean> {
  const exists = await redis.exists(gameKey(gameId))
  return exists === 1
}

// ── Rematch expiry check helper ───────────────────────────────────────────────
// Used by the accept route to reject stale offers without a Lua round-trip.

export function isRematchExpired(offeredAtMs: number): boolean {
  return Date.now() - offeredAtMs > REMATCH_EXPIRY_MS
}
