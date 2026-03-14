import { PrismaClient } from '@prisma/client'
import { Pool }         from 'pg'
import { PrismaPg }     from '@prisma/adapter-pg'

if (!process.env.DATABASE_URL) {
  throw new Error('[db] DATABASE_URL is not set')
}

// Prevent multiple instances in Next.js dev (hot reload creates new modules)
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

function createPrismaClient(): PrismaClient {
  const pool    = new Pool({ connectionString: process.env.DATABASE_URL })
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

// Re-export Prisma types so consumers can import from @draftchess/db
// instead of needing a direct @prisma/client dependency
export * from '@prisma/client'