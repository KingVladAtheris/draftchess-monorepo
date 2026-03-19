// packages/db/src/index.ts

import { PrismaClient } from '@prisma/client'
import { Pool }         from 'pg'
import { PrismaPg }     from '@prisma/adapter-pg'

if (!process.env.DATABASE_URL) {
  throw new Error('[db] DATABASE_URL is not set')
}

// Prevent multiple instances in Next.js dev (hot reload creates new modules)
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

function createPrismaClient(): PrismaClient {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // max: 1 — PgBouncer manages the actual connection pool on its side.
    // Each app process hands off to PgBouncer via a single connection.
    // Without this, each process opens its own pool and defeats the purpose
    // of PgBouncer transaction mode.
    max: 1,
    // Fail fast on connection timeout rather than hanging indefinitely.
    connectionTimeoutMillis: 5_000,
    // Release idle connections after 30s to keep PgBouncer pool clean.
    idleTimeoutMillis: 30_000,
  })

  // Log pool errors — these surface misconfigurations early.
  pool.on('error', (err) => {
    console.error('[db] pg pool error:', err.message)
  })

  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['warn', 'error']
      : ['error'],
  })
}

export const prisma: PrismaClient =
  globalForPrisma.__prisma ?? (globalForPrisma.__prisma = createPrismaClient())

// Re-export Prisma namespace so consumers can import from @draftchess/db
// instead of needing a direct @prisma/client dependency.
export * from '@prisma/client'
