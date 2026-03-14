// packages/socket-types/src/index.ts
// ── Payload types ────────────────────────────────────────────────────────────

export interface GameUpdatePayload {
  fen?:              string
  status?:           'prep' | 'active' | 'finished'
  readyPlayer1?:     boolean
  readyPlayer2?:     boolean
  auxPointsPlayer1?: number
  auxPointsPlayer2?: number
  moveNumber?:       number
  player1Timebank?:  number
  player2Timebank?:  number
  lastMoveAt?:       string | null
  turn?:             'w' | 'b'
  winnerId?:         number | null
  endReason?:        string
  player1EloAfter?:  number
  player2EloAfter?:  number
  eloChange?:        number
  timebankBonusAwarded?: boolean
  timeRemainingOnMove?:  number
  prepStartedAt?:    string | null
  isFriendGame?:     boolean
}

export interface GameSnapshotPayload extends GameUpdatePayload {
  player1Id:  number
  player2Id:  number
  isWhite:    boolean
}

export interface MatchedPayload {
  gameId: number
}

export interface ChallengeAcceptedPayload {
  gameId: number
}

// ── Redis channel message shapes ─────────────────────────────────────────────

export type RedisGameMessage = {
  type:    'game'
  gameId:  number
  event:   string
  payload: Record<string, unknown>
}

export type RedisQueueUserMessage = {
  type:    'queue-user'
  userId:  number
  event:   string
  payload: Record<string, unknown>
}

export type RedisForfeitMessage = {
  type:   'forfeit'
  userId: number
  gameId: number
}

export type RedisMessage =
  | RedisGameMessage
  | RedisQueueUserMessage
  | RedisForfeitMessage

// ── Socket.IO typed event maps ────────────────────────────────────────────────

export interface ServerToClientEvents {
  'game-update':           (payload: GameUpdatePayload) => void
  'game-snapshot':         (payload: GameSnapshotPayload) => void
  'matched':               (payload: MatchedPayload) => void
  'challenge-accepted':    (payload: ChallengeAcceptedPayload) => void
  'opponent-disconnected': (payload: { userId: number; gracePeriodSecs: number }) => void
  'opponent-connected':    (payload: { userId: number }) => void
  'queue-error':           (message: string) => void
}

export interface ClientToServerEvents {
  'join-game':   (gameId: number) => void
  'join-queue':  () => void
  'leave-queue': () => void
  'heartbeat':   () => void
}

export interface InterServerEvents {}

export interface SocketData {
  userId: number
  gameId?: number
}