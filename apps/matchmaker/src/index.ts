// apps/matchmaker/src/index.ts
import { createClient }           from 'redis'
import type { RedisClientType }   from 'redis'
import http                       from 'http'

import { prisma }                 from '@draftchess/db'
import { createMatchWorker }      from './workers/match.js'
import { createPrepWorker }       from './workers/prep.js'
import { createTimeoutWorker }    from './workers/timeout.js'
import { createReconcileWorker }  from './workers/reconcile.js'
import { startForfeitSubscriber } from './lib/forfeit-subscriber.js'
import {
  matchQueue,
  prepQueue,
  timeoutQueue,
  reconcileQueue,
  scheduleTimeout,
} from './queues.js'

// ── Env validation ─────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) { console.error('[matchmaker] DATABASE_URL required'); process.exit(1) }
if (!process.env.REDIS_URL)    { console.error('[matchmaker] REDIS_URL required');    process.exit(1) }

const REDIS_URL   = process.env.REDIS_URL!
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? '3002', 10)

// ── Redis publisher ────────────────────────────────────────────────────────────
// One shared publisher passed into every worker and lib function that needs
// to publish game events. Workers do not create their own Redis connections.
const publisher = createClient({ url: REDIS_URL }) as RedisClientType
publisher.on('error', (err) => console.error('[matchmaker] redis pub error:', err))

// ── Workers ────────────────────────────────────────────────────────────────────
const matchWorker     = createMatchWorker(publisher)
const prepWorker      = createPrepWorker(publisher)
const timeoutWorker   = createTimeoutWorker(publisher)
const reconcileWorker = createReconcileWorker(publisher)

// ── Health server ──────────────────────────────────────────────────────────────
let isHealthy = false

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: isHealthy ? 'ok' : 'starting',
      uptime: Math.floor(process.uptime()),
    }))
  } else {
    res.writeHead(404).end()
  }
})

// ── Boot ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await publisher.connect()
  console.log('[matchmaker] Redis publisher connected')

  // Start the forfeit subscriber — listens for presence expiry events
  // published by the socket server when a player's disconnect grace period expires
  await startForfeitSubscriber(REDIS_URL, publisher)

  console.log('[matchmaker] workers started (match, prep, timeout, reconcile)')

  // ── Seed try-match if players are already waiting ────────────────────────────
  const queuedCount = await prisma.user.count({ where: { queueStatus: 'queued' } })
  if (queuedCount >= 2) {
    await matchQueue.add('try-match', {}, { delay: 500 })
    console.log(`[matchmaker] seeded try-match (${queuedCount} queued players)`)
  }

  // ── Reschedule timeout jobs for active games ─────────────────────────────────
  // Handles the case where the matchmaker restarted mid-game and lost queued jobs
  const activeGames = await prisma.game.findMany({
    where:  { status: 'active' },
    select: {
      id: true, fen: true, lastMoveAt: true,
      player1Id: true, whitePlayerId: true,
      player1Timebank: true, player2Timebank: true,
    },
  })

  for (const g of activeGames) {
    if (!g.lastMoveAt) continue
    const existing = await timeoutQueue.getJob(`timeout-${g.id}`)
    if (!existing) {
      const turn      = g.fen && g.fen.length > 0 ? g.fen.split(' ')[1]! : 'w'
      const whiteIsP1 = g.whitePlayerId === g.player1Id
      await scheduleTimeout(g.id, g.player1Timebank, g.player2Timebank, g.lastMoveAt, turn, whiteIsP1)
      console.log(`[matchmaker] rescheduled timeout for game ${g.id}`)
    }
  }

  // ── Reschedule prep jobs ──────────────────────────────────────────────────────
  const prepGames = await prisma.game.findMany({
    where:  { status: 'prep' },
    select: { id: true, prepStartedAt: true },
  })

  for (const g of prepGames) {
    const existing = await prepQueue.getJob(`prep-${g.id}`)
    if (!existing) {
      const elapsed   = Date.now() - new Date(g.prepStartedAt!).getTime()
      const remaining = Math.max(0, 62_000 - elapsed)
      await prepQueue.add('prep-start', { gameId: g.id }, { delay: remaining, jobId: `prep-${g.id}` })
      console.log(`[matchmaker] rescheduled prep-start for game ${g.id}`)
    }
  }

  // ── Schedule reconciliation (every 5 minutes) ─────────────────────────────────
  await reconcileQueue.add(
    'reconcile',
    {},
    { jobId: 'reconcile-singleton', repeat: { every: 5 * 60 * 1000 } },
  )
  console.log('[matchmaker] reconciliation job scheduled (every 5 min)')

  healthServer.listen(HEALTH_PORT, () => {
    console.log(`[matchmaker] health endpoint listening on :${HEALTH_PORT}`)
  })

  isHealthy = true
  console.log('[matchmaker] ready')
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[matchmaker] ${signal} received, shutting down`)
  isHealthy = false

  await Promise.all([
    matchWorker.close(),
    prepWorker.close(),
    timeoutWorker.close(),
    reconcileWorker.close(),
  ])

  await Promise.all([
    matchQueue.close(),
    prepQueue.close(),
    timeoutQueue.close(),
    reconcileQueue.close(),
    publisher.quit(),
  ])

  healthServer.close(() => {
    console.log('[matchmaker] clean exit')
    process.exit(0)
  })

  // Force exit after 9s if the HTTP server is slow to close
  setTimeout(() => process.exit(1), 9_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

main().catch((err) => {
  console.error('[matchmaker] fatal error during boot:', err)
  process.exit(1)
})
