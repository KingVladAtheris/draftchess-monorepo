// apps/web/src/app/lib/game-ended-types.ts
//
// Shared type for the draftchess:game-ended channel payload.
// Published by the web app (move route, resign route) and consumed
// by the matchmaker's game-ended subscriber.
//
// All ELO state is snapshotted from the Redis game hash at publish time
// so the matchmaker doesn't need an extra Redis or Postgres read.

import type { GameMode } from "@draftchess/shared/game-modes";

export interface GameEndedPayload {
  gameId:             number
  winnerId:           number | null
  endReason:          string
  finalFen:           string
  source:             "move-route" | "resign-route"
  player1Id:          number
  player2Id:          number
  mode:               GameMode
  isFriendGame:       boolean
  player1EloBefore:   number
  player2EloBefore:   number
  player1GamesPlayed: number
  player2GamesPlayed: number
}
