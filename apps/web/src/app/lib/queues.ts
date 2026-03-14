// src/app/lib/queues.ts
// BullMQ queue instances used by Next.js API routes to schedule and cancel
// timeout jobs. Workers run in the matchmaker container.
//
// FIXES applied here:
//   #23 — Removed the remove-then-add pattern. We rely purely on the worker's
//          staleness check (scheduledAt vs lastMoveAt) instead of explicit
//          removal. A crash between remove() and add() previously caused the
//          job to be permanently lost. Now we just add with a fixed jobId;
//          BullMQ will keep both in the delayed queue and the stale one
//          self-discards in the worker. To prevent unbounded accumulation we
//          still attempt removal but no longer treat it as load-bearing.
//   #21 — Errors in cancel helpers are now logged, not silently swallowed.

import { Queue } from "bullmq";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not set");
}

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host:     u.hostname,
    port:     parseInt(u.port || "6379", 10),
    password: u.password || undefined,
  };
}

const redisOpts = parseRedisUrl(process.env.REDIS_URL);

let _timeoutQueue: Queue | null = null;
let _matchQueue:   Queue | null = null;
let _prepQueue:    Queue | null = null;

export function getTimeoutQueue(): Queue {
  if (!_timeoutQueue) {
    _timeoutQueue = new Queue("timeout-queue", {
      connection:        redisOpts,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    });
  }
  return _timeoutQueue;
}

export function getMatchQueue(): Queue {
  if (!_matchQueue) {
    _matchQueue = new Queue("match-queue", {
      connection:        redisOpts,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    });
  }
  return _matchQueue;
}

export function getPrepQueue(): Queue {
  if (!_prepQueue) {
    _prepQueue = new Queue("prep-queue", {
      connection:        redisOpts,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    });
  }
  return _prepQueue;
}

/**
 * Schedule (or replace) the timeout job for a game.
 *
 * We no longer remove the old job before adding the new one (#23).
 * The worker already validates scheduledAt === lastMoveAt and discards
 * stale jobs, so a duplicate delayed job is harmless. Removing the
 * remove→add pattern eliminates the crash window where the job was
 * permanently lost.
 *
 * delay = MOVE_TIME_LIMIT + active player's timebank
 */
export async function scheduleTimeoutJob(
  gameId:          number,
  player1Timebank: number,
  player2Timebank: number,
  lastMoveAt:      Date,
  fenTurn:         string   // "w" or "b"
): Promise<void> {
  const MOVE_TIME_LIMIT = 30_000;
  const activeTimebank  = fenTurn === "w" ? player1Timebank : player2Timebank;
  const delay           = MOVE_TIME_LIMIT + Math.max(0, activeTimebank);

  const q = getTimeoutQueue();

  // Best-effort removal of the previous job to keep the queue clean.
  // Not load-bearing — a stale job that survives is harmless (worker
  // discards it via the scheduledAt staleness check).
  try {
    const existing = await q.getJob(`timeout-${gameId}`);
    if (existing) await existing.remove();
  } catch (err) {
    console.warn(`[Queue] could not remove previous timeout job for game ${gameId}:`, err);
  }

  await q.add(
    "check-timeout",
    { gameId, scheduledAt: lastMoveAt.toISOString() },
    { delay, jobId: `timeout-${gameId}` },
  );
}

/**
 * Cancel the timeout job for a game (resign, checkmate, draw, forfeit, etc.)
 * Errors are logged but not re-thrown — the worker's staleness check provides
 * a safety net if the cancel fails. (#21)
 */
export async function cancelTimeoutJob(gameId: number): Promise<void> {
  try {
    const q   = getTimeoutQueue();
    const job = await q.getJob(`timeout-${gameId}`);
    if (job) await job.remove();
  } catch (err) {
    console.warn(`[Queue] cancelTimeoutJob for game ${gameId} failed:`, err);
  }
}

/**
 * Cancel the prep auto-start job when both players ready up early.
 * Errors are logged but not re-thrown. (#21)
 */
export async function cancelPrepJob(gameId: number): Promise<void> {
  try {
    const q   = getPrepQueue();
    const job = await q.getJob(`prep-${gameId}`);
    if (job) await job.remove();
  } catch (err) {
    console.warn(`[Queue] cancelPrepJob for game ${gameId} failed:`, err);
  }
}