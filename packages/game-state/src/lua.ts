// packages/game-state/src/lua.ts
//
// CHANGES:
//   - DRAW_OFFER_SCRIPT: now enforces 3-move cooldown by checking
//     drawDeclinedMoveNumber, and rejects if an offer is already pending.
//   - DRAW_DECLINE_SCRIPT: atomically clears drawOfferedBy and writes
//     drawDeclinedMoveNumber so the cooldown starts from this move.
//   - REMATCH_OFFER_SCRIPT: sets rematchRequestedBy and rematchOfferedAt
//     atomically, only when game is finished and no offer is pending.
//   - REMATCH_CANCEL_SCRIPT: clears rematch state atomically, used when
//     a player navigates away or the 30s expiry fires.

// ── Move script ───────────────────────────────────────────────────────────────
export const MOVE_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
redis.call('HMSET', KEYS[1],
  'fen',             ARGV[1],
  'moveNumber',      ARGV[2],
  'lastMoveAt',      ARGV[3],
  'lastMoveBy',      ARGV[4],
  'player1Timebank', ARGV[5],
  'player2Timebank', ARGV[6]
)
return 1
`

// ── Place script ──────────────────────────────────────────────────────────────
export const PLACE_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'prep' then
  return -1
end
local points = tonumber(redis.call('HGET', KEYS[1], ARGV[1]))
local cost   = tonumber(ARGV[2])
if points < cost then
  return -2
end
local remaining = points - cost
redis.call('HSET', KEYS[1], ARGV[1], tostring(remaining))
redis.call('HSET', KEYS[1], 'fen', ARGV[3])
return remaining
`

// ── Ready script ──────────────────────────────────────────────────────────────
export const READY_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'prep' then
  return 0
end
local alreadyReady = redis.call('HGET', KEYS[1], ARGV[1])
if alreadyReady == '1' then
  return -1
end
redis.call('HSET', KEYS[1], ARGV[1], '1')
local otherReady = redis.call('HGET', KEYS[1], ARGV[2])
if otherReady == '1' then
  redis.call('HMSET', KEYS[1],
    'status',          'active',
    'lastMoveAt',      ARGV[3],
    'readyPlayer1',    '1',
    'readyPlayer2',    '1',
    'player1Timebank', ARGV[4],
    'player2Timebank', ARGV[5]
  )
  return 2
end
return 1
`

// ── Draw offer script ─────────────────────────────────────────────────────────
// Atomically validates and sets a draw offer.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = userId making the offer (string)
// ARGV[2]  = current moveNumber (string) — for cooldown check
// ARGV[3]  = cooldown moves required (string, "3")
//
// Returns:
//   1  = offer set successfully
//   0  = game not active
//  -1  = cooldown not elapsed (declined too recently)
//  -2  = offer already pending from this player or opponent

export const DRAW_OFFER_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
local existing = tonumber(redis.call('HGET', KEYS[1], 'drawOfferedBy')) or 0
if existing ~= 0 then
  return -2
end
local declinedAt = tonumber(redis.call('HGET', KEYS[1], 'drawDeclinedMoveNumber')) or 0
local currentMove = tonumber(ARGV[2]) or 0
local cooldown = tonumber(ARGV[3]) or 3
if declinedAt ~= 0 and (currentMove - declinedAt) < cooldown then
  return -1
end
redis.call('HSET', KEYS[1], 'drawOfferedBy', ARGV[1])
return 1
`

// ── Draw decline script ───────────────────────────────────────────────────────
// Atomically clears the draw offer and records the move number for cooldown.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = userId declining (must be the non-offerer)
// ARGV[2]  = current moveNumber (string)
//
// Returns:
//   1  = declined successfully
//   0  = game not active
//  -1  = no pending offer to decline

export const DRAW_DECLINE_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
local offeredBy = tonumber(redis.call('HGET', KEYS[1], 'drawOfferedBy')) or 0
if offeredBy == 0 then
  return -1
end
redis.call('HMSET', KEYS[1],
  'drawOfferedBy',          '0',
  'drawDeclinedMoveNumber', ARGV[2]
)
return 1
`

// ── Draw cancel script ────────────────────────────────────────────────────────
// Lets the offering player withdraw their draw offer.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = userId cancelling (must be the offerer)
//
// Returns:
//   1  = cancelled successfully
//   0  = game not active or no offer from this player

export const DRAW_CANCEL_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
local offeredBy = redis.call('HGET', KEYS[1], 'drawOfferedBy')
if offeredBy ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'drawOfferedBy', '0')
return 1
`

// ── Finish script ─────────────────────────────────────────────────────────────
export const FINISH_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
redis.call('HSET', KEYS[1], 'status', 'finished')
return 1
`

// ── Rematch offer script ──────────────────────────────────────────────────────
// Atomically sets a rematch offer on a finished game.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = userId making the offer (string)
// ARGV[2]  = current Unix ms timestamp (string) — stored as rematchOfferedAt
//
// Returns:
//   1  = offer set successfully
//   0  = game not finished
//  -1  = rematch offer already pending

export const REMATCH_OFFER_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'finished' then
  return 0
end
local existing = tonumber(redis.call('HGET', KEYS[1], 'rematchRequestedBy')) or 0
if existing ~= 0 then
  return -1
end
redis.call('HMSET', KEYS[1],
  'rematchRequestedBy', ARGV[1],
  'rematchOfferedAt',   ARGV[2]
)
return 1
`

// ── Rematch cancel script ─────────────────────────────────────────────────────
// Clears rematch state. Called when a player navigates away or the 30s
// expiry fires server-side.
//
// KEYS[1]  = game:{id}
//
// Returns:
//   1  = cleared (offer existed)
//   0  = no offer was pending

export const REMATCH_CANCEL_SCRIPT = `
local existing = tonumber(redis.call('HGET', KEYS[1], 'rematchRequestedBy')) or 0
if existing == 0 then
  return 0
end
redis.call('HMSET', KEYS[1],
  'rematchRequestedBy', '0',
  'rematchOfferedAt',   '0'
)
return 1
`
