// apps/web/src/app/tournaments/[id]/page.tsx

import { prisma }   from '@draftchess/db'
import { auth }     from '@/auth'
import { notFound } from 'next/navigation'
import TournamentDetailClient from './TournamentDetailClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await prisma.tournament.findUnique({ where: { id: parseInt(id, 10) }, select: { name: true } })
  return { title: t ? `${t.name} — DraftChess` : 'Tournament — DraftChess' }
}

export default async function TournamentDetailPage({
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
      prizes: { orderBy: { rankFrom: 'asc' } },
    },
  })

  if (!tournament) notFound()

  // Check if current user is registered
  const isRegistered = userId
    ? tournament.players.some(p => p.userId === userId)
    : false

  // Check required token if present
  let hasRequiredToken = false
  if (userId && tournament.requiredTokenSlug) {
    const token = await prisma.userToken.findFirst({
      where: {
        userId,
        token:     { slug: tournament.requiredTokenSlug },
        status:    'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    })
    hasRequiredToken = !!token
  } else if (!tournament.requiredTokenSlug) {
    hasRequiredToken = true
  }

  // Serialize all dates
  const t = {
    id:                tournament.id,
    name:              tournament.name,
    description:       tournament.description,
    mode:              tournament.mode,
    format:            tournament.format,
    status:            tournament.status,
    startsAt:          tournament.startsAt?.toISOString()           ?? null,
    registrationEndsAt: tournament.registrationEndsAt?.toISOString() ?? null,
    finishedAt:        tournament.finishedAt?.toISOString()         ?? null,
    maxPlayers:        tournament.maxPlayers,
    minPlayers:        tournament.minPlayers,
    requiredTokenSlug: tournament.requiredTokenSlug,
    totalPlayers:      tournament.players.length,
    activePlayers:     tournament.players.filter(p => !p.eliminated).length,
    isRegistered,
    hasRequiredToken,
    userId,
    prizes: tournament.prizes.map(p => ({
      rankFrom:    p.rankFrom,
      rankTo:      p.rankTo,
      prizeType:   p.prizeType,
      tokenSlug:   p.tokenSlug,
      description: p.description,
    })),
    players: tournament.players.map(p => ({
      userId:     p.userId,
      username:   p.user.username,
      score:      p.score,
      buchholz:   p.buchholz,
      rank:       p.rank,
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
        startedAt:   r.startedAt?.toISOString() ?? null,
        finishedAt:  r.finishedAt?.toISOString() ?? null,
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

  return <TournamentDetailClient tournament={t} />
}
