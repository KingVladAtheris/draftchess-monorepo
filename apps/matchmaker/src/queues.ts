// apps/matchmaker/src/queues.ts
// Central place for all BullMQ queue instances and the scheduleTimeout helper.
// Imported by workers (which enqueue/dequeue) and forfeit.ts (which cancels).
// Having one module own the Queue instances avoids creating duplicate connections.

import { Queue } from 'bullmq'

if (!process.env.REDIS_URL) {
  console.error('[queues] REDIS_URL is required')
  process.exit(1)
}

function parseRedisUrl(url: string) {
  const u = new URL(url)
  return {
    host:     u.hostname,
    port:     parseInt(u.port || '6379', 10),
    password: u.password || undefined,
  }
}

const redisOpts    = parseRedisUrl(process.env.REDIS_URL!)
const defaultJobOpts = { removeOnComplete: 100, removeOnFail: 200 }

export const matchQueue     = new Queue('match-queue',     { connection: redisOpts, defaultJobOptions: defaultJobOpts })
export const prepQueue      = new Queue('prep-queue',      { connection: redisOpts, defaultJobOptions: defaultJobOpts })
export const timeoutQueue   = new Queue('timeout-queue',   { connection: redisOpts, defaultJobOptions: defaultJobOpts })
export const reconcileQueue = new Queue('reconcile-queue', { connection: redisOpts, defaultJobOptions: defaultJobOpts })

export { redisOpts }

/**
 * Schedule (or replace) the timeout job for a game.
 * delay = 30s move limit + active player's timebank.
 *
 * fenTurn:  'w' or 'b' from the FEN string
 * whiteIsP1: whether whitePlayerId === player1Id
 * Both are required to correctly map FEN colour → player slot.
 */
export async function scheduleTimeout(
  gameId:          number,
  player1Timebank: number,
  player2Timebank: number,
  lastMoveAt:      Date | string,
  fenTurn          = 'w',
  whiteIsP1        = true,
): Promise<void> {
  const isP1Turn      = fenTurn === 'w' ? whiteIsP1 : !whiteIsP1
  const activeTimebank = isP1Turn ? player1Timebank : player2Timebank
  const delay          = 30_000 + Math.max(0, activeTimebank)

  // Best-effort removal of the previous job to keep the queue clean.
  // Not load-bearing — a stale job that survives is harmless because the
  // worker validates scheduledAt === lastMoveAt before acting.
  try {
    const existing = await timeoutQueue.getJob(`timeout-${gameId}`)
    if (existing) await existing.remove()
  } catch (err: any) {
    console.warn(`[queues] could not remove previous timeout job for game ${gameId}:`, err.message)
  }

  await timeoutQueue.add(
    'check-timeout',
    {
      gameId,
      scheduledAt: lastMoveAt instanceof Date ? lastMoveAt.toISOString() : lastMoveAt,
    },
    { delay, jobId: `timeout-${gameId}` },
  )
}

/**
 * Cancel the timeout job for a finished game.
 * Idempotent — safe to call even if the job doesn't exist.
 */
export async function cancelTimeoutJob(gameId: number): Promise<void> {
  try {
    const job = await timeoutQueue.getJob(`timeout-${gameId}`)
    if (job) await job.remove()
  } catch (err: any) {
    console.warn(`[queues] cancelTimeoutJob for game ${gameId} failed:`, err.message)
  }
}
