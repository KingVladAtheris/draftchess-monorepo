// packages/game-state/src/types.ts
//
// TypeScript representation of the Redis game:{id} hash.
// All fields are always present after seeding — no null values in Redis.
// Booleans are stored as 0 | 1, timestamps as Unix ms integers.

import type { GameMode } from '@draftchess/shared'

// ── The canonical game state object ──────────────────────────────────────────
// This is what every consumer works with after deserialization.
// Never read raw Redis hash fields directly — always go through deserialize().

export interface GameState {
  // Identity
  gameId:        number
  player1Id:     number
  player2Id:     number
  whitePlayerId: number
  mode:          GameMode
  isFriendGame:  boolean

  // Status
  // "finished" should be transient in Redis — the matchmaker deletes the key
  // after writing to Postgres. If you see "finished" in Redis, the cleanup
  // is in progress or failed and the reconcile worker will handle it.
  status: 'prep' | 'active' | 'finished'

  // Position and move state
  fen:        string
  moveNumber: number
  lastMoveAt: number  // Unix ms, 0 if no move yet
  lastMoveBy: number  // userId, 0 if no move yet

  // Time control (milliseconds)
  player1Timebank: number
  player2Timebank: number

  // Prep phase
  prepStartedAt:    number  // Unix ms, 0 if not in prep
  readyPlayer1:     boolean
  readyPlayer2:     boolean
  auxPointsPlayer1: number
  auxPointsPlayer2: number

  // Draft FENs — snapshotted at creation, never mutated
  // Used for FEN masking in snapshot endpoint without a Postgres join
  draft1Fen: string  // white's draft FEN
  draft2Fen: string  // black's draft FEN

  // ELO state — snapshotted at creation, never mutated during game
  // Passed to matchmaker in game-ended event for ELO calculation
  player1EloBefore:   number
  player2EloBefore:   number
  player1GamesPlayed: number
  player2GamesPlayed: number

  // Draw and rematch state (userId, 0 if no active offer)
  drawOfferedBy:      number
  rematchRequestedBy: number
}

// ── Seed payload — what the matchmaker provides at game creation ──────────────
// Stage 1: everything known at creation time.
// Stage 2 (prep → active) uses UpdateGameStatePayload.

export interface SeedGameStatePayload {
  gameId:        number
  player1Id:     number
  player2Id:     number
  whitePlayerId: number
  mode:          GameMode
  isFriendGame:  boolean
  fen:           string
  prepStartedAt: number  // Unix ms
  auxPointsPlayer1: number
  auxPointsPlayer2: number
  player1Timebank:  number
  player2Timebank:  number
  draft1Fen: string
  draft2Fen: string
  player1EloBefore:   number
  player2EloBefore:   number
  player1GamesPlayed: number
  player2GamesPlayed: number
}

// ── Partial update payload — used for stage 2 and move updates ────────────────
// All fields optional — only provided fields are updated in the hash.

export type UpdateGameStatePayload = Partial<Omit<GameState, 'gameId'>>

// ── Result types for Lua script operations ────────────────────────────────────

export type LuaMoveResult =
  | { ok: true }
  | { ok: false; reason: 'not_active' | 'stale' }

export type LuaPlaceResult =
  | { ok: true; newAuxPoints: number }
  | { ok: false; reason: 'insufficient_points' | 'not_prep' | 'occupied' }

export type LuaReadyResult =
  | { ok: true; bothReady: boolean }
  | { ok: false; reason: 'not_prep' | 'already_ready' }

// ── Raw Redis hash — all strings ──────────────────────────────────────────────
// Internal type — only used by serialization.ts.
// Do not use this type in consumers.

export type RawGameHash = Record<string, string>
