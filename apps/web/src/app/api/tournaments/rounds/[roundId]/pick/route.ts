// apps/web/src/app/api/tournaments/rounds/[roundId]/pick/route.ts
//
// POST — record a player's draft pick for an upcoming tournament round.
//
// Called from the game waiting screen when the player is in a tournament round
// and the status is "awaiting_drafts". The player selects a draft from their
// collection (matching the tournament mode) within the 3-minute window.
//
// If both players in the pairing have now picked, the deadline BullMQ job is
// cancelled and draft-deadline fires immediately so the game starts right away.

import { NextRequest, NextResponse } from 'next/server'
import { auth }                      from '@/auth'
import { prisma }                    from '@draftchess/db'
import { tournamentQueue }           from '@draftchess/tournament-engine/queue'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roundId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId  = parseInt(session.user.id, 10)
  const roundId = parseInt((await params).roundId, 10)
  if (isNaN(roundId)) return NextResponse.json({ error: 'Invalid round ID' }, { status: 400 })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { draftId } = body as Record<string, unknown>
  if (!Number.isInteger(draftId) || (draftId as number) <= 0) {
    return NextResponse.json({ error: 'draftId must be a positive integer' }, { status: 400 })
  }

  // Load round + this player's TournamentGame
  const round = await prisma.tournamentRound.findUnique({
    where:   { id: roundId },
    include: {
      games: { where: { isBye: false } },
      stage: { include: { tournament: true } },
    },
  })

  if (!round) {
    return NextResponse.json({ error: 'Round not found' }, { status: 404 })
  }
  if (round.status !== 'awaiting_drafts') {
    return NextResponse.json({ error: 'Round is not currently accepting draft picks' }, { status: 409 })
  }

  // Verify draft belongs to this user and matches tournament mode
  const draft = await prisma.draft.findFirst({
    where: {
      id:     draftId as number,
      userId,
      mode:   round.stage.tournament.mode,
    },
  })
  if (!draft) {
    return NextResponse.json(
      { error: 'Draft not found or does not match tournament mode' },
      { status: 404 },
    )
  }

  // Find this player's pairing in this round
  const tGame = round.games.find(
    g => g.player1Id === userId || g.player2Id === userId,
  )
  if (!tGame) {
    return NextResponse.json({ error: 'You are not in this round' }, { status: 403 })
  }
  if (tGame.gameId) {
    return NextResponse.json({ error: 'Game has already been created for this pairing' }, { status: 409 })
  }

  const isPlayer1 = tGame.player1Id === userId

  await prisma.tournamentGame.update({
    where: { id: tGame.id },
    data:  isPlayer1
      ? { player1DraftId: draftId as number }
      : { player2DraftId: draftId as number },
  })

  // Check if both players have now picked
  const updated = await prisma.tournamentGame.findUnique({
    where: { id: tGame.id },
    select: { player1DraftId: true, player2DraftId: true },
  })

  const bothPicked = !!(updated?.player1DraftId && updated?.player2DraftId)

  if (bothPicked) {
    // Cancel the scheduled deadline job — no need to wait any longer
    try {
      const deadlineJob = await tournamentQueue.getJob(`draft-deadline-${roundId}`)
      if (deadlineJob) await deadlineJob.remove()
    } catch {
      // Job may have already run — safe to ignore
    }

    // Fire draft-deadline immediately so the game is created now
    await tournamentQueue.add('tournament', { type: 'draft-deadline', roundId })
  }

  return NextResponse.json({ success: true, bothPicked })
}
