// packages/game-state/src/lua.ts
//
// Lua scripts for atomic operations on the game hash.
// Each script runs atomically on the Redis server — no race conditions.
//
// Scripts are defined as string constants and loaded via client.defineCommand()
// or passed directly to client.eval(). We use evalSha via defineCommand for
// efficiency — the script is sent once and referenced by SHA thereafter.
//
// Return value conventions (Lua → Redis client):
//   Lua 1          → number 1  (success)
//   Lua 0          → number 0  (soft failure, check reason)
//   Lua error()    → throws in the calling code
//   Lua table      → array of bulk strings

// ── Move script ───────────────────────────────────────────────────────────────
// Atomically validates game is active and updates all move-related fields.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = new fen
// ARGV[2]  = new moveNumber
// ARGV[3]  = lastMoveAt (Unix ms string)
// ARGV[4]  = lastMoveBy (userId string)
// ARGV[5]  = new player1Timebank
// ARGV[6]  = new player2Timebank
//
// Returns:
//   1  = success
//   0  = game not active (already finished or still in prep)

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
// Atomically checks aux points and places a piece during prep.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = points field name ('auxPointsPlayer1' or 'auxPointsPlayer2')
// ARGV[2]  = piece cost (integer string)
// ARGV[3]  = new fen after placement
//
// Returns:
//   new aux points remaining (integer >= 0)  = success
//  -1  = game not in prep
//  -2  = insufficient points

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
// Marks one player ready. If both are ready, transitions to active.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = this player's ready field ('readyPlayer1' or 'readyPlayer2')
// ARGV[2]  = opponent's ready field    ('readyPlayer2' or 'readyPlayer1')
// ARGV[3]  = lastMoveAt for active transition (Unix ms string, i.e. now)
// ARGV[4]  = player1Timebank for active transition
// ARGV[5]  = player2Timebank for active transition
//
// Returns:
//   2  = both ready, game transitioned to active — caller publishes game-started
//   1  = this player marked ready, waiting for opponent
//   0  = game not in prep
//  -1  = this player was already ready

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
// Sets or clears drawOfferedBy atomically.
//
// KEYS[1]  = game:{id}
// ARGV[1]  = userId making the offer (string), or '0' to clear
//
// Returns:
//   1  = offer set or cleared
//   0  = game not active

export const DRAW_OFFER_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
redis.call('HSET', KEYS[1], 'drawOfferedBy', ARGV[1])
return 1
`

// ── Finish script ─────────────────────────────────────────────────────────────
// Transitions game to finished atomically.
// Used by the move route when it detects a terminal position,
// before publishing to draftchess:game-ended.
//
// KEYS[1]  = game:{id}
//
// Returns:
//   1  = transitioned to finished
//   0  = game was not active (another path already finished it)

export const FINISH_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then
  return 0
end
redis.call('HSET', KEYS[1], 'status', 'finished')
return 1
`
