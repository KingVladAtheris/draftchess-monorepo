// apps/web/src/app/api/tournaments/[id]/register/route.ts
// POST — register the authenticated player for a tournament.
//        Checks token requirement, consumes if consumeOnEntry, idempotent.

import { NextRequest, NextResponse }         from 'next/server'
import { auth }                              from '@/auth'
import { prisma }                            from '@draftchess/db'
import { userHasToken, consumeTokenForEntry } from '@draftchess/token-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId  = parseInt(session.user.id, 10)
  const tournId = parseInt((await params).id, 10)
  if (isNaN(tournId)) return NextResponse.json({ error: 'Invalid tournament ID' }, { status: 400 })

  const tournament = await prisma.tournament.findUnique({ where: { id: tournId } })

  if (!tournament) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  }
  if (tournament.status !== 'upcoming') {
    return NextResponse.json({ error: 'Registration is closed' }, { status: 409 })
  }
  if (tournament.registrationEndsAt && tournament.registrationEndsAt < new Date()) {
    return NextResponse.json({ error: 'Registration deadline has passed' }, { status: 409 })
  }
  if (tournament.maxPlayers) {
    const count = await prisma.tournamentPlayer.count({ where: { tournamentId: tournId } })
    if (count >= tournament.maxPlayers) {
      return NextResponse.json({ error: 'Tournament is full' }, { status: 409 })
    }
  }

  // ── Token entry gate ──────────────────────────────────────────────────────
  if (tournament.requiredTokenSlug) {
    const tokenDef = await prisma.tokenDefinition.findUnique({
      where: { slug: tournament.requiredTokenSlug },
    })
    if (!tokenDef) {
      return NextResponse.json({ error: 'Entry token configuration error' }, { status: 500 })
    }

    const hasIt = await userHasToken(userId, tournament.requiredTokenSlug)
    if (!hasIt) {
      return NextResponse.json(
        { error: `You need the "${tokenDef.label}" token to enter this tournament` },
        { status: 403 },
      )
    }

    if (tokenDef.consumeOnEntry) {
      const consumed = await consumeTokenForEntry(userId, tournament.requiredTokenSlug)
      if (!consumed) {
        return NextResponse.json({ error: 'Entry token could not be consumed' }, { status: 403 })
      }
    }
  }

  // ── Idempotent registration ───────────────────────────────────────────────
  const existing = await prisma.tournamentPlayer.findUnique({
    where: { tournamentId_userId: { tournamentId: tournId, userId } },
  })
  if (existing) {
    return NextResponse.json({ error: 'Already registered' }, { status: 409 })
  }

  await prisma.tournamentPlayer.create({
    data: { tournamentId: tournId, userId },
  })

  return NextResponse.json({ success: true }, { status: 201 })
}
