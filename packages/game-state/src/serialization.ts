// packages/game-state/src/serialization.ts
//
// CHANGES:
//   - Added drawDeclinedMoveNumber to deserialize, serializeSeed, serializeUpdate
//   - Added rematchOfferedAt to deserialize, serializeSeed, serializeUpdate

import type { GameMode }      from '@draftchess/shared'
import type { GameState, RawGameHash, SeedGameStatePayload } from './types'

function int(val: string | undefined): number {
  const n = parseInt(val ?? '0', 10)
  return isNaN(n) ? 0 : n
}

function bool(val: string | undefined): boolean {
  return val === '1'
}

function str(val: string | undefined): string {
  return val ?? ''
}

function toInt(val: number): string {
  return String(Math.floor(val))
}

function toBool(val: boolean): string {
  return val ? '1' : '0'
}

export function deserialize(raw: RawGameHash): GameState {
  return {
    gameId:        int(raw.gameId),
    player1Id:     int(raw.player1Id),
    player2Id:     int(raw.player2Id),
    whitePlayerId: int(raw.whitePlayerId),
    mode:          str(raw.mode) as GameMode,
    isFriendGame:  bool(raw.isFriendGame),

    status: (str(raw.status) || 'prep') as GameState['status'],

    fen:        str(raw.fen),
    moveNumber: int(raw.moveNumber),
    lastMoveAt: int(raw.lastMoveAt),
    lastMoveBy: int(raw.lastMoveBy),

    player1Timebank: int(raw.player1Timebank),
    player2Timebank: int(raw.player2Timebank),

    prepStartedAt:    int(raw.prepStartedAt),
    readyPlayer1:     bool(raw.readyPlayer1),
    readyPlayer2:     bool(raw.readyPlayer2),
    auxPointsPlayer1: int(raw.auxPointsPlayer1),
    auxPointsPlayer2: int(raw.auxPointsPlayer2),

    draft1Fen: str(raw.draft1Fen),
    draft2Fen: str(raw.draft2Fen),

    player1EloBefore:   int(raw.player1EloBefore),
    player2EloBefore:   int(raw.player2EloBefore),
    player1GamesPlayed: int(raw.player1GamesPlayed),
    player2GamesPlayed: int(raw.player2GamesPlayed),

    drawOfferedBy:          int(raw.drawOfferedBy),
    drawDeclinedMoveNumber: int(raw.drawDeclinedMoveNumber),

    rematchRequestedBy: int(raw.rematchRequestedBy),
    rematchOfferedAt:   int(raw.rematchOfferedAt),
  }
}

export function serializeSeed(payload: SeedGameStatePayload): string[] {
  return [
    'gameId',        toInt(payload.gameId),
    'player1Id',     toInt(payload.player1Id),
    'player2Id',     toInt(payload.player2Id),
    'whitePlayerId', toInt(payload.whitePlayerId),
    'mode',          payload.mode,
    'isFriendGame',  toBool(payload.isFriendGame),

    'status',        'prep',

    'fen',           payload.fen,
    'moveNumber',    '0',
    'lastMoveAt',    '0',
    'lastMoveBy',    '0',

    'player1Timebank', toInt(payload.player1Timebank),
    'player2Timebank', toInt(payload.player2Timebank),

    'prepStartedAt',    toInt(payload.prepStartedAt),
    'readyPlayer1',     '0',
    'readyPlayer2',     '0',
    'auxPointsPlayer1', toInt(payload.auxPointsPlayer1),
    'auxPointsPlayer2', toInt(payload.auxPointsPlayer2),

    'draft1Fen', payload.draft1Fen,
    'draft2Fen', payload.draft2Fen,

    'player1EloBefore',   toInt(payload.player1EloBefore),
    'player2EloBefore',   toInt(payload.player2EloBefore),
    'player1GamesPlayed', toInt(payload.player1GamesPlayed),
    'player2GamesPlayed', toInt(payload.player2GamesPlayed),

    'drawOfferedBy',          '0',
    'drawDeclinedMoveNumber', '0',

    'rematchRequestedBy', '0',
    'rematchOfferedAt',   '0',
  ]
}

export function serializeUpdate(
  update: Partial<Omit<GameState, 'gameId'>>
): string[] {
  const pairs: string[] = []

  const push = (field: string, val: string) => { pairs.push(field, val) }

  if (update.player1Id     !== undefined) push('player1Id',     toInt(update.player1Id))
  if (update.player2Id     !== undefined) push('player2Id',     toInt(update.player2Id))
  if (update.whitePlayerId !== undefined) push('whitePlayerId', toInt(update.whitePlayerId))
  if (update.mode          !== undefined) push('mode',          update.mode)
  if (update.isFriendGame  !== undefined) push('isFriendGame',  toBool(update.isFriendGame))
  if (update.status        !== undefined) push('status',        update.status)

  if (update.fen        !== undefined) push('fen',        update.fen)
  if (update.moveNumber !== undefined) push('moveNumber', toInt(update.moveNumber))
  if (update.lastMoveAt !== undefined) push('lastMoveAt', toInt(update.lastMoveAt))
  if (update.lastMoveBy !== undefined) push('lastMoveBy', toInt(update.lastMoveBy))

  if (update.player1Timebank !== undefined) push('player1Timebank', toInt(update.player1Timebank))
  if (update.player2Timebank !== undefined) push('player2Timebank', toInt(update.player2Timebank))

  if (update.prepStartedAt    !== undefined) push('prepStartedAt',    toInt(update.prepStartedAt))
  if (update.readyPlayer1     !== undefined) push('readyPlayer1',     toBool(update.readyPlayer1))
  if (update.readyPlayer2     !== undefined) push('readyPlayer2',     toBool(update.readyPlayer2))
  if (update.auxPointsPlayer1 !== undefined) push('auxPointsPlayer1', toInt(update.auxPointsPlayer1))
  if (update.auxPointsPlayer2 !== undefined) push('auxPointsPlayer2', toInt(update.auxPointsPlayer2))

  if (update.draft1Fen !== undefined) push('draft1Fen', update.draft1Fen)
  if (update.draft2Fen !== undefined) push('draft2Fen', update.draft2Fen)

  if (update.player1EloBefore   !== undefined) push('player1EloBefore',   toInt(update.player1EloBefore))
  if (update.player2EloBefore   !== undefined) push('player2EloBefore',   toInt(update.player2EloBefore))
  if (update.player1GamesPlayed !== undefined) push('player1GamesPlayed', toInt(update.player1GamesPlayed))
  if (update.player2GamesPlayed !== undefined) push('player2GamesPlayed', toInt(update.player2GamesPlayed))

  if (update.drawOfferedBy          !== undefined) push('drawOfferedBy',          toInt(update.drawOfferedBy))
  if (update.drawDeclinedMoveNumber !== undefined) push('drawDeclinedMoveNumber', toInt(update.drawDeclinedMoveNumber))

  if (update.rematchRequestedBy !== undefined) push('rematchRequestedBy', toInt(update.rematchRequestedBy))
  if (update.rematchOfferedAt   !== undefined) push('rematchOfferedAt',   toInt(update.rematchOfferedAt))

  return pairs
}
