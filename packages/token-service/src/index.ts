// packages/token-service/src/index.ts
//
// All token operations go through here. Never touch UserToken directly elsewhere.
//
// Design:
//   @@unique([userId, tokenId]) — one row per (user, token) pair.
//   Permanent tokens:  upsert, expiresAt = null.
//   Duration tokens:   extend existing active row's expiresAt from current expiry;
//                      create fresh row if none exists or if revoked/expired.
//   "active" + (expiresAt null OR expiresAt > now) = valid token.

import { prisma } from '@draftchess/db'
import { logger } from '@draftchess/logger'

const log = logger.child({ module: 'token-service' })

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GrantTokenOpts {
  userId:    number
  tokenSlug: string
  grantedBy?: number   // AdminUser.id — null for auto-grants (tournament prizes, achievements)
  note?:      string
  stripePaymentIntentId?: string
}

// ─── Grant ────────────────────────────────────────────────────────────────────

export async function grantToken(opts: GrantTokenOpts): Promise<void> {
  const { userId, tokenSlug, grantedBy, note, stripePaymentIntentId } = opts

  const definition = await prisma.tokenDefinition.findUnique({
    where: { slug: tokenSlug },
  })
  if (!definition) throw new Error(`TokenDefinition not found: ${tokenSlug}`)

  const existing = await prisma.userToken.findUnique({
    where: { userId_tokenId: { userId, tokenId: definition.id } },
  })

  // ── Permanent token ──────────────────────────────────────────────────────
  if (!definition.durationDays) {
    if (existing) {
      await prisma.userToken.update({
        where: { id: existing.id },
        data:  {
          status:    'active',
          expiresAt: null,
          note:      note ?? existing.note,
        },
      })
    } else {
      await prisma.userToken.create({
        data: {
          userId,
          tokenId:               definition.id,
          grantedBy:             grantedBy ?? null,
          note:                  note ?? null,
          stripePaymentIntentId: stripePaymentIntentId ?? null,
          status:                'active',
          expiresAt:             null,
        },
      })
    }
    log.info({ userId, tokenSlug, permanent: true }, 'token granted')
    return
  }

  // ── Duration token ───────────────────────────────────────────────────────
  const durationMs = definition.durationDays * 86_400_000

  if (existing && existing.status === 'active' && existing.expiresAt) {
    // Extend from current expiry (not from today — prevents losing time)
    const newExpiry = new Date(existing.expiresAt.getTime() + durationMs)
    await prisma.userToken.update({
      where: { id: existing.id },
      data: {
        expiresAt:             newExpiry,
        stripePaymentIntentId: stripePaymentIntentId ?? existing.stripePaymentIntentId,
        note:                  note ?? existing.note,
      },
    })
    log.info({ userId, tokenSlug, newExpiry }, 'duration token extended')
  } else {
    // Create fresh or reactivate expired/revoked row
    const expiresAt = new Date(Date.now() + durationMs)
    await prisma.userToken.upsert({
      where:  { userId_tokenId: { userId, tokenId: definition.id } },
      create: {
        userId,
        tokenId:               definition.id,
        grantedBy:             grantedBy ?? null,
        note:                  note ?? null,
        stripePaymentIntentId: stripePaymentIntentId ?? null,
        status:                'active',
        expiresAt,
      },
      update: {
        status:                'active',
        expiresAt,
        grantedBy:             grantedBy ?? null,
        note:                  note ?? null,
        stripePaymentIntentId: stripePaymentIntentId ?? null,
      },
    })
    log.info({ userId, tokenSlug, expiresAt }, 'duration token granted')
  }
}

// ─── Revoke ───────────────────────────────────────────────────────────────────
// Sets status = "revoked". Keeps the row — audit trail.

export async function revokeToken(opts: {
  userId:    number
  tokenSlug: string
}): Promise<void> {
  const { userId, tokenSlug } = opts

  const definition = await prisma.tokenDefinition.findUnique({
    where: { slug: tokenSlug },
  })
  if (!definition) throw new Error(`TokenDefinition not found: ${tokenSlug}`)

  const result = await prisma.userToken.updateMany({
    where: { userId, tokenId: definition.id, status: 'active' },
    data:  { status: 'revoked' },
  })

  if (result.count === 0) {
    log.warn({ userId, tokenSlug }, 'revokeToken: no active token found')
  } else {
    log.info({ userId, tokenSlug }, 'token revoked')
  }
}

// ─── Check ────────────────────────────────────────────────────────────────────

export async function userHasToken(userId: number, tokenSlug: string): Promise<boolean> {
  const definition = await prisma.tokenDefinition.findUnique({
    where: { slug: tokenSlug },
  })
  if (!definition) return false

  const count = await prisma.userToken.count({
    where: {
      userId,
      tokenId: definition.id,
      status:  'active',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  })

  return count > 0
}

// ─── Consume on entry ─────────────────────────────────────────────────────────
// Used for consumeOnEntry = true tokens (qualifier passes etc.).
// Atomically checks presence and revokes. Returns false if no valid token.

export async function consumeTokenForEntry(
  userId:    number,
  tokenSlug: string,
): Promise<boolean> {
  const definition = await prisma.tokenDefinition.findUnique({
    where: { slug: tokenSlug },
  })
  if (!definition || !definition.consumeOnEntry) return false

  const token = await prisma.userToken.findUnique({
    where: { userId_tokenId: { userId, tokenId: definition.id } },
  })

  if (
    !token ||
    token.status !== 'active' ||
    (token.expiresAt && token.expiresAt <= new Date())
  ) {
    return false
  }

  await prisma.userToken.update({
    where: { id: token.id },
    data:  { status: 'revoked' },
  })

  log.info({ userId, tokenSlug }, 'token consumed for tournament entry')
  return true
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
// Called by the nightly token-cleanup worker in the matchmaker.

export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.userToken.updateMany({
    where: {
      status:    'active',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'expired' },
  })

  log.info({ updated: result.count }, 'expired tokens marked')
  return result.count
}

// ─── Get active tokens for user ───────────────────────────────────────────────

export async function getActiveTokensForUser(userId: number) {
  return prisma.userToken.findMany({
    where: {
      userId,
      status: 'active',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: { token: true },
    orderBy: { grantedAt: 'asc' },
  })
}
