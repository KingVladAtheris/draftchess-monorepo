// apps/web/src/app/play/game/[id]/page.tsx
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { redirect } from "next/navigation";
import ClientGame from "./ClientGame";
import { buildCombinedDraftFen, maskOpponentAuxPlacements } from "@draftchess/shared/fen-utils";

interface GamePageProps {
  params: Promise<{ id: string }>;
}

export default async function GamePage({ params }: GamePageProps) {
  const { id } = await params;
  const gameId = parseInt(id, 10);

  if (isNaN(gameId)) {
    redirect("/play/select");
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = parseInt(session.user.id);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
      draft1: { select: { fen: true } },
      draft2: { select: { fen: true } },
    },
  });

  if (!game) {
    redirect("/play/select?error=game_not_found");
  }

  if (game.player1Id !== userId && game.player2Id !== userId) {
    redirect("/play/select?error=not_participant");
  }

  // isWhite is determined by whitePlayerId, NOT by player1Id.
  // player1/player2 are matchmaking slots (queue order), color is assigned separately.
  const isWhite = game.whitePlayerId === userId;

  // Apply prep masking server-side so the initial render is already correct.
  // This prevents the flash of the full (unmasked) FEN before the client's
  // status fetch completes.
  let initialFen = game.fen ?? "start";
  if (game.status === "prep" && game.draft1?.fen && game.draft2?.fen) {
    const originalFen = buildCombinedDraftFen(game.draft1.fen, game.draft2.fen);
    initialFen = maskOpponentAuxPlacements(initialFen, originalFen, isWhite);
  }

  return (
    <ClientGame
      gameId={gameId}
      myUserId={userId}
      initialFen={initialFen}
      isWhite={isWhite}
      initialStatus={game.status}
      initialPrepStartedAt={game.prepStartedAt}
      initialReadyPlayer1={game.readyPlayer1}
      initialReadyPlayer2={game.readyPlayer2}
      initialAuxPointsPlayer1={game.auxPointsPlayer1}
      initialAuxPointsPlayer2={game.auxPointsPlayer2}
      player1Id={game.player1Id}
      player2Id={game.player2Id}
      mode={game.mode ?? "standard"}
    />
  );
}
