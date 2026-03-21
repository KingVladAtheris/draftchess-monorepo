// apps/matchmaker/src/queues.ts
//
// CHANGE: scheduleTimeout no longer does a remove-then-add sequence.
// The gap between remove and add could leave no job in the queue if the
// process crashed between those two operations.
//
// Instead: add with jobId deduplication first (BullMQ will reject the add
// if a job with the same ID already exists), then attempt to remove the old
// job if the new add failed due to an existing job. This ensures there is
// always a timeout job in the queue — we never have a window with none.
//
// The approach: use upsert semantics by removing first only when we know
// the scheduledAt has changed (stale job), otherwise just attempt to add.
// The timeout worker's scheduledAt check makes surviving stale jobs harmless.

import { Queue } from 'bullmq'
import { logger } from '@draftchess/logger'

const log = logger.child({ module: 'matchmaker:queues' })

if (!process.env.REDIS_URL) {
  log.fatal('REDIS_URL is required')
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

const redisOpts      = parseRedisUrl(process.env.REDIS_URL!)
const defaultJobOpts = { removeOnComplete: 100, removeOnFail: 200 }

export const matchQueue     = new Queue('match-queue',     { connection: redisOpts, defaultJobOptions: defaultJobOpts })
export const prepQueue      = new Queue('prep-queue',      { connection: redisOpts, defaultJobOptions: defaultJobOpts })
export const timeoutQueue   = new Queue('timeout-queue',   { connection: redisOpts, defaultJobOptions: defaultJobOpts })
export const reconcileQueue = new Queue('reconcile-queue', { connection: redisOpts, defaultJobOptions: defaultJobOpts })

export { redisOpts }

/**
 * Schedule (or replace) the timeout job for a game.
 *
 * Safety: we always ensure a job exists in the queue before returning.
 * Strategy:
 *   1. Try to add with the new delay and jobId.
 *   2. If BullMQ rejects because a job with that ID already exists,
 *      remove the old one and add the new one.
 * This avoids the remove→crash→no-job window of the previous approach.
 * A surviving stale job is harmless — the worker validates scheduledAt.
 */
export async function scheduleTimeout(
  gameId:          number,
  player1Timebank: number,
  player2Timebank: number,
  lastMoveAt:      Date | string,
  fenTurn          = 'w',
  whiteIsP1        = true,
): Promise<void> {
  const isP1Turn       = fenTurn === 'w' ? whiteIsP1 : !whiteIsP1
  const activeTimebank = isP1Turn ? player1Timebank : player2Timebank
  const delay          = 30_000 + Math.max(0, activeTimebank)
  const scheduledAt    = lastMoveAt instanceof Date ? lastMoveAt.toISOString() : lastMoveAt
  const jobId          = `timeout-${gameId}`

  try {
    await timeoutQueue.add(
      'check-timeout',
      { gameId, scheduledAt, rescheduleCount: 0 },
      { delay, jobId },
    )
    return
  } catch (addErr: any) {
    // BullMQ throws if a job with this jobId already exists in certain states.
    // Remove it and retry once.
    log.warn({ gameId, err: addErr.message }, 'timeout add failed — removing stale job and retrying')
  }

  try {
    const existing = await timeoutQueue.getJob(jobId)
    if (existing) await existing.remove()
  } catch (removeErr: any) {
    log.warn({ gameId, err: removeErr.message }, 'could not remove stale timeout job')
  }

  // Final add — if this fails, the reconcile worker will catch the stale game.
  await timeoutQueue.add(
    'check-timeout',
    { gameId, scheduledAt, rescheduleCount: 0 },
    { delay, jobId },
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
    log.warn({ gameId, err: err.message }, 'cancelTimeoutJob failed')
  }
}
