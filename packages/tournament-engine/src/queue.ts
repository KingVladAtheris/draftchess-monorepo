// packages/tournament-engine/src/queue.ts
//
// Shared Queue instance imported by both the matchmaker worker and the
// admin API routes inside apps/web. Both sides enqueue to the same
// "tournament-queue" BullMQ queue — the matchmaker worker consumes it.

import { Queue } from 'bullmq'

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const u = new URL(url)
  return {
    host:     u.hostname,
    port:     parseInt(u.port || '6379', 10),
    password: u.password || undefined,
  }
}

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set')
}

export const tournamentQueue = new Queue('tournament-queue', {
  connection:        parseRedisUrl(process.env.REDIS_URL),
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
})
