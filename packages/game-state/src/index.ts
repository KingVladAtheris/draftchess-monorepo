// packages/game-state/src/index.ts

export type {
  GameState,
  SeedGameStatePayload,
  UpdateGameStatePayload,
  LuaMoveResult,
  LuaPlaceResult,
  LuaReadyResult,
  LuaDrawOfferResult,
  LuaDrawDeclineResult,
  LuaRematchOfferResult,
  RawGameHash,
} from './types'

export {
  gameKey,
  seedGameState,
  getGameState,
  getGameField,
  updateGameState,
  deleteGameState,
  applyMove,
  placePiece,
  markReady,
  offerDraw,
  declineDraw,
  cancelDraw,
  markGameFinished,
  offerRematch,
  cancelRematch,
  isRematchExpired,
  gameExists,
} from './client'

export { loadGameState } from './fallback'

export {
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
