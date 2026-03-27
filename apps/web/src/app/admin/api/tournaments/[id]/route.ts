// apps/web/src/app/admin/api/tournaments/[id]/route.ts
// GET   — full tournament detail for monitoring
// PATCH — actions: activate | disqualify | pause-stage | resume-stage | end-stage | cancel

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@draftchess/db'
import { requireAdmin }              from '@/app/lib/admin-auth'
import { tournamentQueue }           from '@draftchess/tournament-engine/queue'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

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
        orderBy: { score: 'desc' },
        include: { user: { select: { id: true, username: true } } },
      },
      prizes: true,
    },
  })

  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ tournament })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  const tournId = parseInt((await params).id, 10)
  if (isNaN(tournId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { action, ...data } = body as Record<string, unknown>

  switch (action) {

    case 'activate': {
      const t = await prisma.tournament.findUnique({
        where:   { id: tournId },
        include: { stages: { orderBy: { stageNumber: 'asc' } } },
      })
      if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (t.status !== 'upcoming') {
        return NextResponse.json({ error: 'Tournament must be upcoming to activate' }, { status: 409 })
      }

      await prisma.tournament.update({ where: { id: tournId }, data: { status: 'active' } })

      const first = t.stages[0]
      if (first) {
        const delay = first.startTimeType === 'fixed' && first.fixedStartAt
          ? Math.max(0, first.fixedStartAt.getTime() - Date.now())
          : 0
        await tournamentQueue.add('tournament', { type: 'stage-start', stageId: first.id }, { delay })
      }

      return NextResponse.json({ success: true })
    }

    case 'disqualify': {
      const userId = data.userId
      if (!Number.isInteger(userId) || (userId as number) <= 0) {
        return NextResponse.json({ error: 'userId must be a positive integer' }, { status: 400 })
      }

      await prisma.tournamentPlayer.updateMany({
        where: { tournamentId: tournId, userId: userId as number },
        data:  { eliminated: true },
      })

      // Forfeit any active games for this player
      const activeGames = await prisma.tournamentGame.findMany({
        where: {
          winnerId: null, isDraw: false, isBye: false,
          OR:    [{ player1Id: userId as number }, { player2Id: userId as number }],
          round: { stage: { tournamentId: tournId } },
        },
      })

      for (const tg of activeGames) {
        const oppId = tg.player1Id === userId ? tg.player2Id : tg.player1Id
        await prisma.tournamentGame.update({ where: { id: tg.id }, data: { winnerId: oppId } })
        await tournamentQueue.add('tournament', { type: 'round-check', roundId: tg.roundId })
      }

      return NextResponse.json({ success: true })
    }

    case 'pause-stage': {
      if (!Number.isInteger(data.stageId)) {
        return NextResponse.json({ error: 'stageId required' }, { status: 400 })
      }
      await prisma.tournamentStage.update({
        where: { id: data.stageId as number },
        data:  { status: 'paused' },
      })
      return NextResponse.json({ success: true })
    }

    case 'resume-stage': {
      if (!Number.isInteger(data.stageId)) {
        return NextResponse.json({ error: 'stageId required' }, { status: 400 })
      }
      await prisma.tournamentStage.update({
        where: { id: data.stageId as number },
        data:  { status: 'active' },
      })
      return NextResponse.json({ success: true })
    }

    case 'end-stage': {
      if (!Number.isInteger(data.stageId)) {
        return NextResponse.json({ error: 'stageId required' }, { status: 400 })
      }
      await tournamentQueue.add('tournament', {
        type:    'stage-finish',
        stageId: data.stageId as number,
      })
      return NextResponse.json({ success: true })
    }

    case 'cancel': {
      await prisma.tournament.update({
        where: { id: tournId },
        data:  { status: 'cancelled', finishedAt: new Date() },
      })
      return NextResponse.json({ success: true })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${String(action)}` }, { status: 400 })
  }
}
