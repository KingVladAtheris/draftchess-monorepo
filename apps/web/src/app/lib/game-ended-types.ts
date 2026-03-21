// apps/web/src/app/lib/game-ended-types.ts
//
// CHANGE: Added "draw-route" to source union to cover draw acceptance.

import type { GameMode } from "@draftchess/shared/game-modes";

export interface GameEndedPayload {
  gameId:             number
  winnerId:           number | null
  endReason:          string
  finalFen:           string
  source:             "move-route" | "resign-route" | "draw-route"
  player1Id:          number
  player2Id:          number
  mode:               GameMode
  isFriendGame:       boolean
  player1EloBefore:   number
  player2EloBefore:   number
  player1GamesPlayed: number
  player2GamesPlayed: number
}
