// packages/game-state/src/index.ts

// Types
export type {
  GameState,
  SeedGameStatePayload,
  UpdateGameStatePayload,
  LuaMoveResult,
  LuaPlaceResult,
  LuaReadyResult,
  RawGameHash,
} from './types'

// Redis client operations
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
  setDrawOffer,
  markGameFinished,
  gameExists,
} from './client'

// Cold start fallback
export { loadGameState } from './fallback'

// Lua scripts (exported for testing and debugging)
export {
  MOVE_SCRIPT,
  PLACE_SCRIPT,
  READY_SCRIPT,
  DRAW_OFFER_SCRIPT,
  FINISH_SCRIPT,
} from './lua'
