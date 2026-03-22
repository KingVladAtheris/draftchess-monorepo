// apps/web/src/app/play/game/[id]/replay/page.tsx

import { prisma }      from "@draftchess/db";
import { redirect }    from "next/navigation";
import ClientReplay    from "./ClientReplay";

interface ReplayPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReplayPage({ params }: ReplayPageProps) {
  const { id }  = await params;
  const gameId  = parseInt(id, 10);

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
      winnerId:      true,
      endReason:     true,
      player1EloBefore: true,
      player2EloBefore: true,
      player1EloAfter:  true,
      player2EloAfter:  true,
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
      moves:  {
        orderBy: { moveNumber: "asc" },
        select:  {
          moveNumber: true,
          from:       true,
          to:         true,
          san:        true,
          fen:        true,
          promotion:  true,
        },
      },
    },
  });

  if (!game || game.status !== "finished") redirect("/");

  // Build PGN
  const pgn = buildPgn(game);

  return (
    <ClientReplay
      gameId={gameId}
      mode={game.mode ?? "standard"}
      player1={game.player1}
      player2={game.player2}
      whitePlayerId={game.whitePlayerId}
      winnerId={game.winnerId ?? null}
      endReason={game.endReason ?? null}
      player1EloBefore={game.player1EloBefore ?? null}
      player2EloBefore={game.player2EloBefore ?? null}
      player1EloAfter={game.player1EloAfter ?? null}
      player2EloAfter={game.player2EloAfter ?? null}
      moves={game.moves}
      pgn={pgn}
      finalFen={game.fen ?? ""}
    />
  );
}

function buildPgn(game: {
  id: number;
  mode: string | null;
  player1: { id: number; username: string };
  player2: { id: number; username: string };
  whitePlayerId: number;
  winnerId: number | null;
  endReason: string | null;
  moves: { moveNumber: number; san: string }[];
}): string {
  const white = game.whitePlayerId === game.player1.id ? game.player1.username : game.player2.username;
  const black = game.whitePlayerId === game.player1.id ? game.player2.username : game.player1.username;

  const result = game.winnerId === null
    ? "1/2-1/2"
    : game.winnerId === (game.whitePlayerId === game.player1.id ? game.player1.id : game.player2.id)
      ? "1-0"
      : "0-1";

  const date = new Date().toISOString().split("T")[0]!.replace(/-/g, ".");

  const header = [
    `[Event "DraftChess ${game.mode ?? "standard"}"]`,
    `[Site "draftchess.com"]`,
    `[Date "${date}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
  ].join("\n");

  // Build move text — pair white and black moves
  const movePairs: string[] = [];
  for (let i = 0; i < game.moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const white   = game.moves[i]?.san   ?? "";
    const black   = game.moves[i + 1]?.san ?? "";
    movePairs.push(black ? `${moveNum}. ${white} ${black}` : `${moveNum}. ${white}`);
  }

  return `${header}\n\n${movePairs.join(" ")} ${result}`;
}
