// apps/matchmaker/src/index.ts

import { createClient }               from 'redis'
import type { RedisClientType }       from 'redis'
import http                           from 'http'

import { prisma }                     from '@draftchess/db'
import { seedGameState }              from '@draftchess/game-state'
import { logger }                     from '@draftchess/logger'
import {
  type GameMode,
  MODE_CONFIG,
  GAMES_PLAYED_FIELD,
} from '@draftchess/shared/game-modes'

import { createMatchWorker }          from './workers/match.js'
import { createPrepWorker }           from './workers/prep.js'
import { createTimeoutWorker }        from './workers/timeout.js'
import { createReconcileWorker }      from './workers/reconcile.js'
import { startForfeitSubscriber }     from './lib/forfeit-subscriber.js'
import { startGameEndedSubscriber }   from './lib/game-ended-subscriber.js'
import { startGameStartedSubscriber } from './lib/game-started-subscriber.js'
import { startQueueJoinSubscriber }   from './lib/queue-join-subscriber.js'
import {
  matchQueue,
  prepQueue,
  timeoutQueue,
  reconcileQueue,
  scheduleTimeout,
} from './queues.js'

const log = logger.child({ module: 'matchmaker' })

// ── Env validation ─────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) { log.fatal('DATABASE_URL required'); process.exit(1) }
if (!process.env.REDIS_URL)    { log.fatal('REDIS_URL required');    process.exit(1) }

const REDIS_URL   = process.env.REDIS_URL!
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? '3002', 10)

// ── Redis publisher ────────────────────────────────────────────────────────────
// One shared publisher passed into every worker and lib function that needs
// to publish game events. Workers do not create their own Redis connections.
const publisher = createClient({ url: REDIS_URL }) as RedisClientType
publisher.on('error', (err) => log.error({ err }, 'redis publisher error'))

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
  log.info('Redis publisher connected')

  // ── Start subscribers ────────────────────────────────────────────────────────
  await startForfeitSubscriber(REDIS_URL, publisher)
  await startGameEndedSubscriber(REDIS_URL, publisher)
  await startGameStartedSubscriber(REDIS_URL)
  await startQueueJoinSubscriber(REDIS_URL)

  log.info('workers started (match, prep, timeout, reconcile)')
  log.info('subscribers started (forfeit, game-ended, game-started, queue-join)')

  // ── Seed try-match if players are already waiting ────────────────────────────
  const queuedCount = await prisma.user.count({ where: { queueStatus: 'queued' } })
  if (queuedCount >= 2) {
    await matchQueue.add('try-match', {}, { delay: 500 })
    log.info({ queuedCount }, 'seeded try-match for waiting players')
  }

  // ── Reseed Redis for active games ─────────────────────────────────────────────
  // If the matchmaker restarted mid-game, Redis hashes may have expired.
  // Rebuild them from Postgres so the move route, timeout worker, and
  // reconcile worker all have game state to work with.
  const activeGames = await prisma.game.findMany({
    where:  { status: { in: ['active', 'prep'] } },
    select: {
      id:               true,
      status:           true,
      mode:             true,
      isFriendGame:     true,
      fen:              true,
      player1Id:        true,
      player2Id:        true,
      whitePlayerId:    true,
      prepStartedAt:    true,
      readyPlayer1:     true,
      readyPlayer2:     true,
      auxPointsPlayer1: true,
      auxPointsPlayer2: true,
      player1Timebank:  true,
      player2Timebank:  true,
      lastMoveAt:       true,
      lastMoveBy:       true,
      moveNumber:       true,
      player1EloBefore: true,
      player2EloBefore: true,
      draft1: { select: { fen: true } },
      draft2: { select: { fen: true } },
      player1: {
        select: {
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      },
      player2: {
        select: {
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      },
    },
  })

  for (const g of activeGames) {
    const mode       = (g.mode ?? 'standard') as GameMode
    const gamesField = GAMES_PLAYED_FIELD[mode]
    const auxPoints  = MODE_CONFIG[mode].auxPoints

    // Check if hash already exists — only reseed on miss
    const { gameExists } = await import('@draftchess/game-state')
    const exists = await gameExists(publisher, g.id)

    if (!exists) {
      await seedGameState(publisher, {
        gameId:        g.id,
        player1Id:     g.player1Id,
        player2Id:     g.player2Id,
        whitePlayerId: g.whitePlayerId,
        mode,
        isFriendGame:  g.isFriendGame,
        fen:           g.fen ?? '8/8/8/8/8/8/8/4K3 w - - 0 1',
        prepStartedAt: g.prepStartedAt ? g.prepStartedAt.getTime() : 0,
        auxPointsPlayer1: g.auxPointsPlayer1 ?? auxPoints,
        auxPointsPlayer2: g.auxPointsPlayer2 ?? auxPoints,
        player1Timebank:  g.player1Timebank,
        player2Timebank:  g.player2Timebank,
        draft1Fen:        g.draft1?.fen ?? '',
        draft2Fen:        g.draft2?.fen ?? '',
        player1EloBefore:   g.player1EloBefore ?? 1200,
        player2EloBefore:   g.player2EloBefore ?? 1200,
        player1GamesPlayed: g.player1[gamesField] ?? 0,
        player2GamesPlayed: g.player2[gamesField] ?? 0,
      })

      // If already active, patch in the move state
      if (g.status === 'active' && g.lastMoveAt) {
        const { updateGameState } = await import('@draftchess/game-state')
        await updateGameState(publisher, g.id, {
          status:      'active',
          lastMoveAt:  g.lastMoveAt.getTime(),
          lastMoveBy:  g.lastMoveBy ?? 0,
          moveNumber:  g.moveNumber,
          readyPlayer1: g.readyPlayer1,
          readyPlayer2: g.readyPlayer2,
        })
      }

      log.info({ gameId: g.id, status: g.status }, 'reseeded Redis hash on boot')
    }

    // ── Reschedule timeout jobs for active games ────────────────────────────────
    if (g.status === 'active' && g.lastMoveAt) {
      const existing = await timeoutQueue.getJob(`timeout-${g.id}`)
      if (!existing) {
        const turn      = g.fen && g.fen.length > 0 ? g.fen.split(' ')[1]! : 'w'
        const whiteIsP1 = g.whitePlayerId === g.player1Id
        await scheduleTimeout(g.id, g.player1Timebank, g.player2Timebank, g.lastMoveAt, turn, whiteIsP1)
        log.info({ gameId: g.id }, 'rescheduled timeout on boot')
      }
    }

    // ── Reschedule prep jobs ────────────────────────────────────────────────────
    if (g.status === 'prep' && g.prepStartedAt) {
      const existing = await prepQueue.getJob(`prep-${g.id}`)
      if (!existing) {
        const elapsed   = Date.now() - new Date(g.prepStartedAt).getTime()
        const remaining = Math.max(0, 62_000 - elapsed)
        await prepQueue.add('prep-start', { gameId: g.id }, { delay: remaining, jobId: `prep-${g.id}` })
        log.info({ gameId: g.id }, 'rescheduled prep-start on boot')
      }
    }
  }

  // ── Schedule reconciliation (every 5 minutes) ──────────────────────────────
  await reconcileQueue.add(
    'reconcile',
    {},
    { jobId: 'reconcile-singleton', repeat: { every: 5 * 60 * 1000 } },
  )
  log.info('reconciliation job scheduled (every 5 min)')

  // ── Schedule nightly token cleanup ────────────────────────────────────────
  // Expires tokens past their expiresAt, sends reminder notifications
  // for tokens expiring within 3 days, publishes entitlement revocations.
  // Runs at midnight UTC — tunable via TOKEN_CLEANUP_CRON env var.
  const { tokenCleanupQueue } = await import('./queues.js').then(async (q) => {
    // We'll add this queue when we build the token cleanup worker
    // For now just log that it will be scheduled
    return { tokenCleanupQueue: null }
  })
  log.info('token cleanup job will be scheduled when worker is built')

  healthServer.listen(HEALTH_PORT, () => {
    log.info({ port: HEALTH_PORT }, 'health endpoint listening')
  })

  isHealthy = true
  log.info('matchmaker ready')
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutdown received')
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
    log.info('clean exit')
    process.exit(0)
  })

  // Force exit after 9s if the HTTP server is slow to close
  setTimeout(() => process.exit(1), 9_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

main().catch((err) => {
  log.fatal({ err }, 'fatal error during boot')
  process.exit(1)
})