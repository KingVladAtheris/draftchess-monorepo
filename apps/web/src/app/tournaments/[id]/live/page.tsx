// apps/web/src/app/tournaments/[id]/live/page.tsx

import { prisma }   from '@draftchess/db'
import { auth }     from '@/auth'
import { notFound } from 'next/navigation'
import TournamentLiveClient from './TournamentLiveClient'

export const metadata = { title: 'Live — DraftChess' }

export default async function TournamentLivePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id }  = await params
  const tournId = parseInt(id, 10)
  if (isNaN(tournId)) notFound()

  const session = await auth()
  const userId  = session?.user?.id ? parseInt(session.user.id, 10) : null

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
                  game: { select: { id: true, status: true, winnerId: true, endReason: true } },
                },
              },
            },
          },
          placements: { orderBy: { rank: 'asc' } },
        },
      },
      players: {
        orderBy: [{ score: 'desc' }, { buchholz: 'desc' }],
        include: { user: { select: { id: true, username: true } } },
      },
    },
  })

  if (!tournament) notFound()

  const t = {
    id:           tournament.id,
    name:         tournament.name,
    mode:         tournament.mode,
    status:       tournament.status,
    totalPlayers: tournament.players.length,
    activePlayers: tournament.players.filter(p => !p.eliminated).length,
    userId,
    players: tournament.players.map(p => ({
      userId:     p.userId,
      username:   p.user.username,
      score:      p.score,
      buchholz:   p.buchholz,
      eliminated: p.eliminated,
    })),
    stages: tournament.stages.map(s => ({
      id:          s.id,
      stageNumber: s.stageNumber,
      name:        s.name,
      format:      s.format,
      status:      s.status,
      totalRounds: s.totalRounds,
      currentRound: s.currentRound,
      advanceCount: s.advanceCount,
      placements:  s.placements.map(p => ({ userId: p.userId, rank: p.rank, rankLabel: p.rankLabel })),
      rounds: s.rounds.map(r => ({
        id:          r.id,
        roundNumber: r.roundNumber,
        status:      r.status,
        draftPickDeadline: r.draftPickDeadline?.toISOString() ?? null,
        games: r.games.map(g => ({
          id:        g.id,
          player1Id: g.player1Id,
          player2Id: g.player2Id,
          isBye:     g.isBye,
          winnerId:  g.winnerId,
          isDraw:    g.isDraw,
          gameId:    g.gameId,
          gameStatus: g.game?.status ?? null,
        })),
      })),
    })),
  }

  return <TournamentLiveClient tournament={t} />
}
