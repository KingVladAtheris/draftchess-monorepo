// apps/web/src/app/api/tournaments/[id]/live/route.ts
// GET — lightweight live data for the tournament live view polling.

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@draftchess/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tournId = parseInt((await params).id, 10)
  if (isNaN(tournId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

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

  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const t = {
    id:           tournament.id,
    name:         tournament.name,
    mode:         tournament.mode,
    status:       tournament.status,
    totalPlayers: tournament.players.length,
    activePlayers: tournament.players.filter(p => !p.eliminated).length,
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

  return NextResponse.json({ tournament: t })
}
