// packages/logger/src/index.ts
//
// Universal logger for all DraftChess services and packages.
// Every app and package imports from here and creates a child logger.
//
// Usage:
//   import { logger } from '@draftchess/logger'
//   const log = logger.child({ module: 'matchmaker:finalize' })
//
//   log.info({ gameId }, 'game finalized')
//   log.warn({ gameId, reason }, 'skipping stale job')
//   log.error({ err, gameId }, 'transaction failed')
//
// Log levels (from LOG_LEVEL env var, default: debug in dev, info in prod):
//   trace, debug, info, warn, error, fatal
//
// In development: pretty-printed, colorized, human-readable.
// In production:  newline-delimited JSON for log aggregators (Datadog, Logtail etc).
//
// Child logger context is merged into every log line automatically:
//   { module: 'matchmaker:finalize', gameId: 42, level: 'info', msg: '...' }

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),

  // Production: structured JSON with ISO timestamps and field redaction.
  // Development: pretty-printed via pino-pretty transport.
  ...(isDev
    ? {
        transport: {
          target:  'pino-pretty',
          options: {
            colorize:        true,
            ignore:          'pid,hostname',
            translateTime:   'SYS:HH:MM:ss',
            messageFormat:   '{module} — {msg}',
          },
        },
      }
    : {
        timestamp: pino.stdTimeFunctions.isoTime,
        // Redact sensitive fields wherever they appear in log objects.
        // Covers nested paths — e.g. req.headers.authorization is also redacted.
        redact: {
          paths: [
            'password',
            'passwordHash',
            '*.password',
            '*.passwordHash',
            'token',
            '*.token',
            'secret',
            '*.secret',
            'authorization',
            '*.authorization',
            'req.headers.authorization',
            'stripeCustomerId',
            '*.stripeCustomerId',
            'stripePaymentIntentId',
            '*.stripePaymentIntentId',
          ],
          censor: '[REDACTED]',
        },
      }
  ),
})

// Re-export the pino type so consumers can type their child loggers
// without a direct pino dependency.
export type { Logger } from 'pino'
