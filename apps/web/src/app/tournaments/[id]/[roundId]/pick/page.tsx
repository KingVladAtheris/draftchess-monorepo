// apps/web/src/app/tournaments/[id]/[roundId]/pick/page.tsx
//
// Standalone draft pick page shown to players at round start.
// Players have 1 minute to pick a draft. Auto-redirects to /play/game/[id]
// when tournament-game-ready fires via socket.

import { prisma }   from '@draftchess/db'
import { auth }     from '@/auth'
import { notFound, redirect } from 'next/navigation'
import DraftPickClient from './DraftPickClient'

export const metadata = { title: 'Pick your draft — DraftChess' }

export default async function DraftPickPage({
  params,
}: {
  params: Promise<{ id: string; roundId: string }>
}) {
  const { id, roundId: roundIdStr } = await params
  const tournId = parseInt(id, 10)
  const roundId = parseInt(roundIdStr, 10)
  if (isNaN(tournId) || isNaN(roundId)) notFound()

  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const userId = parseInt(session.user.id, 10)

  // Load round and tournament
  const round = await prisma.tournamentRound.findUnique({
    where:   { id: roundId },
    include: {
      stage: {
        include: { tournament: { select: { id: true, name: true, mode: true } } },
      },
      games: {
        where: {
          isBye: false,
          OR:    [{ player1Id: userId }, { player2Id: userId }],
        },
      },
    },
  })

  if (!round) notFound()

  // Verify this round belongs to the tournament in the URL
  if (round.stage.tournament.id !== tournId) notFound()

  // If round is no longer awaiting drafts, redirect to live view
  if (round.status !== 'awaiting_drafts') {
    redirect(`/tournaments/${tournId}/live`)
  }

  // Verify player is in this round
  const tGame = round.games[0]
  if (!tGame) redirect(`/tournaments/${tournId}/live`)

  // Load player's drafts for this mode
  const drafts = await prisma.draft.findMany({
    where:   { userId, mode: round.stage.tournament.mode },
    select:  { id: true, name: true, points: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })

  // Has this player already picked?
  const isPlayer1    = tGame.player1Id === userId
  const alreadyPicked = isPlayer1 ? !!tGame.player1DraftId : !!tGame.player2DraftId

  return (
    <DraftPickClient
      tournamentId={tournId}
      tournamentName={round.stage.tournament.name}
      mode={round.stage.tournament.mode}
      roundId={roundId}
      roundNumber={round.roundNumber}
      deadline={round.draftPickDeadline?.toISOString() ?? null}
      drafts={drafts.map(d => ({
        id:        d.id,
        name:      d.name,
        points:    d.points,
        updatedAt: d.updatedAt.toISOString(),
      }))}
      alreadyPicked={alreadyPicked}
      pickedDraftId={isPlayer1 ? tGame.player1DraftId : tGame.player2DraftId}
    />
  )
}
