// apps/web/src/app/tournaments/page.tsx
// Public tournament listing — no login required.
// Shows upcoming, active, and finished tournaments in tabs.

import { prisma }   from '@draftchess/db'
import { auth }     from '@/auth'
import TournamentsListClient from './TournamentsListClient'

export const metadata = { title: 'Tournaments — DraftChess' }

export default async function TournamentsPage() {
  const session = await auth()
  const userId  = session?.user?.id ? parseInt(session.user.id, 10) : null

  const tournaments = await prisma.tournament.findMany({
    where:   { status: { in: ['upcoming', 'active', 'finished'] } },
    orderBy: [{ status: 'asc' }, { startsAt: 'asc' }],
    include: {
      _count:  { select: { players: true } },
      prizes:  { take: 3, orderBy: { rankFrom: 'asc' } },
      stages:  { orderBy: { stageNumber: 'asc' }, select: { format: true, stageNumber: true } },
      players: userId
        ? { where: { userId }, select: { userId: true } }
        : false,
    },
  })

  // Serialize dates for client boundary
  const serialized = tournaments.map(t => ({
    id:                t.id,
    name:              t.name,
    description:       t.description,
    mode:              t.mode,
    format:            t.format,
    status:            t.status,
    startsAt:          t.startsAt?.toISOString()           ?? null,
    registrationEndsAt: t.registrationEndsAt?.toISOString() ?? null,
    finishedAt:        t.finishedAt?.toISOString()         ?? null,
    maxPlayers:        t.maxPlayers,
    minPlayers:        t.minPlayers,
    requiredTokenSlug: t.requiredTokenSlug,
    playerCount:       t._count.players,
    stageFormats:      t.stages.map(s => s.format),
    isRegistered:      userId ? t.players.length > 0 : false,
    prizes:            t.prizes.map(p => ({
      rankFrom:    p.rankFrom,
      rankTo:      p.rankTo,
      prizeType:   p.prizeType,
      tokenSlug:   p.tokenSlug,
      description: p.description,
    })),
  }))

  return <TournamentsListClient tournaments={serialized} isLoggedIn={!!userId} />
}
