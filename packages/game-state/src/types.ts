// packages/game-state/src/types.ts
//
// CHANGES:
//   - Added drawDeclinedMoveNumber: tracks which move a draw decline happened
//     on, so the 3-move cooldown can be enforced atomically in Redis.
//   - Added rematchOfferedAt: Unix ms timestamp of when the rematch was offered,
//     used to enforce the 30-second expiry on accept.

import type { GameMode } from '@draftchess/shared'

export interface GameState {
  // Identity
  gameId:        number
  player1Id:     number
  player2Id:     number
  whitePlayerId: number
  mode:          GameMode
  isFriendGame:  boolean

  status: 'prep' | 'active' | 'finished'

  // Position and move state
  fen:        string
  moveNumber: number
  lastMoveAt: number
  lastMoveBy: number

  // Time control (milliseconds)
  player1Timebank: number
  player2Timebank: number

  // Prep phase
  prepStartedAt:    number
  readyPlayer1:     boolean
  readyPlayer2:     boolean
  auxPointsPlayer1: number
  auxPointsPlayer2: number

  // Draft FENs
  draft1Fen: string
  draft2Fen: string

  // ELO state
  player1EloBefore:   number
  player2EloBefore:   number
  player1GamesPlayed: number
  player2GamesPlayed: number

  // Draw state
  // drawOfferedBy: userId of the player who offered, 0 if no active offer
  // drawDeclinedMoveNumber: moveNumber when the last decline happened, 0 if never.
  //   Cooldown enforced by checking moveNumber - drawDeclinedMoveNumber >= 3.
  drawOfferedBy:        number
  drawDeclinedMoveNumber: number

  // Rematch state
  // rematchRequestedBy: userId of the player who offered rematch, 0 if none
  // rematchOfferedAt: Unix ms when the offer was made, 0 if none.
  //   30-second expiry enforced on accept.
  rematchRequestedBy: number
  rematchOfferedAt:   number
}

export interface SeedGameStatePayload {
  gameId:        number
  player1Id:     number
  player2Id:     number
  whitePlayerId: number
  mode:          GameMode
  isFriendGame:  boolean
  fen:           string
  prepStartedAt: number
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

export type UpdateGameStatePayload = Partial<Omit<GameState, 'gameId'>>

export type LuaMoveResult =
  | { ok: true }
  | { ok: false; reason: 'not_active' | 'stale' }

export type LuaPlaceResult =
  | { ok: true; newAuxPoints: number }
  | { ok: false; reason: 'insufficient_points' | 'not_prep' | 'occupied' }

export type LuaReadyResult =
  | { ok: true; bothReady: boolean }
  | { ok: false; reason: 'not_prep' | 'already_ready' }

export type LuaDrawOfferResult =
  | { ok: true }
  | { ok: false; reason: 'not_active' | 'cooldown' | 'already_offered' }

export type LuaDrawDeclineResult =
  | { ok: true }
  | { ok: false; reason: 'not_active' | 'no_offer' }

export type LuaRematchOfferResult =
  | { ok: true }
  | { ok: false; reason: 'not_finished' | 'already_offered' }

export type RawGameHash = Record<string, string>
