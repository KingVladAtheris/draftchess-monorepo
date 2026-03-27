// apps/matchmaker/src/workers/token-cleanup.ts
//
// Nightly cron job that marks expired UserToken rows as status = "expired".
// Scheduled once at matchmaker startup with a stable jobId so it survives restarts.
//
// Wire into apps/matchmaker/src/index.ts:
//
//   import { tokenCleanupQueue, tokenCleanupWorker } from './workers/token-cleanup.js'
//
//   await tokenCleanupQueue.add('cleanup', {}, {
//     jobId:  'token-cleanup-singleton',
//     repeat: { pattern: '0 0 * * *' },  // midnight UTC daily
//   })
//
//   // Add tokenCleanupWorker.close() to your graceful shutdown Promise.all

import { Worker, Queue }        from 'bullmq'
import { cleanupExpiredTokens } from '@draftchess/token-service'
import { redisOpts }            from '../queues.js'
import { logger }               from '@draftchess/logger'

const log = logger.child({ module: 'matchmaker:token-cleanup' })

export const tokenCleanupQueue = new Queue('token-cleanup-queue', {
  connection:        redisOpts,
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

export const tokenCleanupWorker = new Worker(
  'token-cleanup-queue',
  async () => {
    log.info('token cleanup started')
    const count = await cleanupExpiredTokens()
    log.info({ count }, 'token cleanup complete')
  },
  { connection: redisOpts, concurrency: 1 },
)

tokenCleanupWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'token cleanup job failed'),
)
