// apps/web/src/app/admin/tournaments/page.tsx

import { getAdminSession } from '@/app/lib/admin-auth'
import { redirect }        from 'next/navigation'
import { prisma }          from '@draftchess/db'
import TournamentsClient   from './TournamentsClient'

export const metadata = { title: 'Tournaments — Admin' }

export default async function AdminTournamentsPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const [tournaments, tokenDefs] = await Promise.all([
    prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        stages:  { orderBy: { stageNumber: 'asc' } },
        prizes:  true,
        _count:  { select: { players: true } },
      },
    }),
    prisma.tokenDefinition.findMany({
      orderBy: { slug: 'asc' },
      select:  { slug: true, label: true },
    }),
  ])

  return (
    <TournamentsClient
      tournaments={tournaments.map(t => ({
        ...t,
        startsAt:           t.startsAt?.toISOString()           ?? null,
        registrationEndsAt: t.registrationEndsAt?.toISOString() ?? null,
        stages: t.stages.map(s => ({
          ...s,
          fixedStartAt: s.fixedStartAt?.toISOString() ?? null,
          startedAt:    s.startedAt?.toISOString()    ?? null,
          finishedAt:   s.finishedAt?.toISOString()   ?? null,
        })),
      }))}
      tokenDefs={tokenDefs}
    />
  )
}
