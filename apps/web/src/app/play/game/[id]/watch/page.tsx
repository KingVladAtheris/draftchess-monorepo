// apps/web/src/app/play/game/[id]/watch/page.tsx

import { prisma }       from "@draftchess/db";
import { redirect }     from "next/navigation";
import ClientSpectator  from "./ClientSpectator";

interface WatchPageProps {
  params: Promise<{ id: string }>;
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { id }   = await params;
  const gameId   = parseInt(id, 10);

  if (isNaN(gameId)) redirect("/");

  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      id:            true,
      status:        true,
      mode:          true,
      fen:           true,
      whitePlayerId: true,
      moveNumber:    true,
      player1Timebank: true,
      player2Timebank: true,
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
      draft1:  { select: { fen: true } },
      draft2:  { select: { fen: true } },
    },
  });

  if (!game) redirect("/");

  // Compute the spectator-safe initial FEN:
  // prep → original combined draft FEN (no aux placements)
  // active/finished → full FEN
  let initialFen = game.fen ?? "";
  if (game.status === "prep" && game.draft1?.fen && game.draft2?.fen) {
    const { buildCombinedDraftFen } = await import("@draftchess/shared/fen-utils");
    initialFen = buildCombinedDraftFen(game.draft1.fen, game.draft2.fen);
  }

  return (
    <ClientSpectator
      gameId={gameId}
      initialFen={initialFen}
      initialStatus={game.status}
      mode={game.mode ?? "standard"}
      player1={game.player1}
      player2={game.player2}
      whitePlayerId={game.whitePlayerId}
      initialMoveNumber={game.moveNumber}
      initialPlayer1Timebank={game.player1Timebank}
      initialPlayer2Timebank={game.player2Timebank}
    />
  );
}
