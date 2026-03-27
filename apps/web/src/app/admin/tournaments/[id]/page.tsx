// apps/web/src/app/admin/tournaments/[id]/page.tsx

import { getAdminSession } from '@/app/lib/admin-auth'
import { redirect, notFound } from 'next/navigation'
import { prisma }          from '@draftchess/db'
import TournamentMonitor   from './TournamentMonitor'

export const metadata = { title: 'Tournament — Admin' }

export default async function AdminTournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const { id } = await params
  const tournId = parseInt(id, 10)
  if (isNaN(tournId)) notFound()

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournId },
    include: {
      stages: {
        orderBy: { stageNumber: 'asc' },
        include: {
          rounds: {
            orderBy: { roundNumber: 'asc' },
            include: {
              games: {
                include: {
                  game: {
                    select: { id: true, status: true, winnerId: true, endReason: true },
                  },
                },
              },
            },
          },
          placements: {
            orderBy: { rank: 'asc' },
            include: { stage: false },
          },
        },
      },
      players: {
        orderBy: { score: 'desc' },
        include: { user: { select: { id: true, username: true } } },
      },
      prizes: true,
    },
  })

  if (!tournament) notFound()

  return <TournamentMonitor tournament={tournament as any} />
}
