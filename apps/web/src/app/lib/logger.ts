// src/app/lib/logger.ts
// Pino logger singleton for all server-side code.
// Use this instead of console.log/warn/error everywhere in API routes,
// server actions, and server.ts.
//
// Usage:
//   import { logger } from '@/app/lib/logger';
//   const log = logger.child({ module: 'queue' });
//   log.info({ gameId }, 'game started');
//   log.error({ err, gameId }, 'timeout failed');
//
// In production (NODE_ENV=production) outputs newline-delimited JSON.
// In development outputs pretty-printed human-readable logs.
// Compatible with pino-pretty for local dev:
//   npx pino-pretty  (pipe stdout through it)

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  ...(isDev
    ? {
        transport: {
          target:  'pino-pretty',
          options: { colorize: true, ignore: 'pid,hostname' },
        },
      }
    : {
        // Production: structured JSON, include timestamp as ISO string
        timestamp: pino.stdTimeFunctions.isoTime,
        // Redact sensitive fields wherever they appear in log objects
        redact: {
          paths: ['*.password', '*.passwordHash', '*.token', '*.secret', '*.authorization'],
          censor: '[REDACTED]',
        },
      }
  ),
});
