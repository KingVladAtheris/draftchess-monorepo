// apps/socket-server/src/index.ts
import { createServer }        from 'http'
import { Server }              from 'socket.io'
import { createAdapter }       from '@socket.io/redis-adapter'
import { createClient }        from 'redis'
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@draftchess/socket-types'

import { authMiddleware }        from './auth.js'
import { registerGameHandlers }  from './handlers/game.js'
import { registerQueueHandlers } from './handlers/queue.js'
import { registerDisconnect }    from './handlers/disconnect.js'
import { startPresenceExpiry }   from './presence.js'
import { subscribeToRedis }      from './subscriber.js'

// ── Env validation ────────────────────────────────────────────────────────────
// Do this before anything else so failures are obvious at startup, not mid-request.
const REDIS_URL      = process.env.REDIS_URL
const AUTH_SECRET    = process.env.AUTH_SECRET
const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const PORT           = parseInt(process.env.SOCKET_PORT ?? '3001', 10)

if (!REDIS_URL)   { console.error('[socket] REDIS_URL is required');   process.exit(1) }
if (!AUTH_SECRET) { console.error('[socket] AUTH_SECRET is required'); process.exit(1) }

// ── Redis clients ─────────────────────────────────────────────────────────────
// Three clients because redis requires separate connections for pub, sub, and commands.
// A subscribed client cannot issue regular commands.
function makeRedis() {
  const c = createClient({ url: REDIS_URL! })
  c.on('error',        (err) => console.error('[redis] error', err))
  c.on('reconnecting', ()    => console.warn('[redis] reconnecting'))
  return c
}

const pubClient = makeRedis() // socket.io redis adapter — publisher
const subClient = makeRedis() // socket.io redis adapter — subscriber
const cmdClient = makeRedis() // presence keys, online keys, general commands

await Promise.all([pubClient.connect(), subClient.connect(), cmdClient.connect()])
console.log('[socket] Redis connected')

// ── Verify Redis keyspace notifications are enabled ───────────────────────────
// The presence/forfeit system depends on __keyevent__:expired events.
// Warn loudly if they're not configured but don't exit — managed Redis
// (ElastiCache, Upstash) may block CONFIG GET even when notifications are on.
try {
  const config = await cmdClient.configGet('notify-keyspace-events')
  const flags  = (config['notify-keyspace-events'] ?? '').toUpperCase()
  if (!flags.includes('E') || !flags.includes('X')) {
    console.error(
      '[socket] WARNING: Redis notify-keyspace-events does not include E+x. ' +
      'Presence-based forfeit will not fire. Add --notify-keyspace-events KExg ' +
      'to your Redis config.',
    )
  } else {
    console.log(`[socket] Redis keyspace notifications OK (flags: ${flags})`)
  }
} catch {
  console.warn('[socket] Could not verify Redis keyspace notifications (CONFIG GET blocked). ' +
    'Ensure notify-keyspace-events includes Ex on your Redis instance.')
}

// ── HTTP server ───────────────────────────────────────────────────────────────
// Minimal — only used for the healthcheck probe.
// All real traffic goes through Socket.IO.
const httpServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200).end('ok')
  } else {
    res.writeHead(404).end()
  }
})

// ── Socket.IO ─────────────────────────────────────────────────────────────────
export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors:           { origin: ALLOWED_ORIGIN, credentials: true },
  pingInterval:   25_000,
  pingTimeout:    20_000,
  connectTimeout: 10_000,
})

io.adapter(createAdapter(pubClient, subClient))
io.use(authMiddleware)

io.on('connection', socket => {
  const { userId } = socket.data
  console.log(`[socket] user ${userId} connected — socket ${socket.id}`)

  // Mark online in Redis. TTL 70s, refreshed by client heartbeat every 60s.
  cmdClient.set(`online:${userId}`, '1', { EX: 70 }).catch(() => {})

  // Every authenticated user gets their own room for targeted messages
  // (matched notification, challenge accepted, etc.)
  socket.join(`queue-user-${userId}`)

  socket.on('heartbeat', () => {
    cmdClient.set(`online:${userId}`, '1', { EX: 70 }).catch(() => {})
  })

  registerGameHandlers(io, socket, cmdClient)
  registerQueueHandlers(socket)
  registerDisconnect(io, socket, cmdClient)
})

// ── Redis pub/sub fan-out ─────────────────────────────────────────────────────
// Subscribes to the game-events channel and forwards messages to socket rooms.
await subscribeToRedis(io, cmdClient)

// ── Presence expiry → forfeit ─────────────────────────────────────────────────
// Watches for Redis key expiry and publishes to draftchess:forfeit channel.
// The matchmaker subscribes to that channel and calls forfeitGame().
await startPresenceExpiry(cmdClient)

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[socket] listening on :${PORT}`)
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[socket] ${signal} received, shutting down`)
  await io.close()
  await Promise.all([pubClient.quit(), subClient.quit(), cmdClient.quit()])
  console.log('[socket] clean exit')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))