// apps/web/src/app/api/game/[id]/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import {
  buildCombinedDraftFen,
  maskOpponentAuxPlacements,
} from "@draftchess/shared/fen-utils";

const MOVE_TIME_LIMIT = 30000; // 30 seconds in ms

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = parseInt(session.user.id);
  const gameId = parseInt(id);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      fen: true,
      status: true,
      prepStartedAt: true,
      readyPlayer1: true,
      readyPlayer2: true,
      auxPointsPlayer1: true,
      auxPointsPlayer2: true,
      player1Id: true,
      player2Id: true,
      whitePlayerId: true,
      draft1: { select: { fen: true } },
      draft2: { select: { fen: true } },
      lastMoveAt: true,
      lastMoveBy: true,
      moveNumber: true,
      player1Timebank: true,
      player2Timebank: true,
      winnerId: true,
      endReason: true,
      player1EloAfter: true,
      player2EloAfter: true,
      eloChange: true,
    },
  });

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a participant in this game" }, { status: 403 });
  }

  // isWhite derived from whitePlayerId — player1/player2 are queue slots, not colors
  const isWhite = game.whitePlayerId === userId;
  const isPlayer1 = game.player1Id === userId;
  const currentFen = game.fen ?? "";

  // ─── FEN masking during prep ──────────────────────────────────────────────
  // During prep, each player can only see their own aux placements.
  // Once the game is active, the full FEN is revealed to both.
  let fen = currentFen;
  let originalDraftFen: string | null = null;

  if (game.status === "prep" && game.draft1?.fen && game.draft2?.fen) {
    originalDraftFen = buildCombinedDraftFen(game.draft1.fen, game.draft2.fen);
    fen = maskOpponentAuxPlacements(currentFen, originalDraftFen, isWhite);
  }

  // ─── Timer calculation ────────────────────────────────────────────────────
  let timeRemainingOnMove = MOVE_TIME_LIMIT;
  let isMyTurn = false;
  let currentPlayerTimebank: number | null = null;

  if (game.status === "active") {
    // Derive turn from FEN — server authoritative
    const turn = currentFen.split(" ")[1]; // "w" or "b"
    isMyTurn = (turn === "w" && isWhite) || (turn === "b" && !isWhite);

    if (game.lastMoveAt) {
      const now = new Date();
      const elapsed = now.getTime() - new Date(game.lastMoveAt).getTime();

      if (isMyTurn) {
        timeRemainingOnMove = Math.max(0, MOVE_TIME_LIMIT - elapsed);

        // Calculate timebank remaining for the current player
        const myTimebank = isPlayer1 ? game.player1Timebank : game.player2Timebank;
        if (elapsed > MOVE_TIME_LIMIT) {
          currentPlayerTimebank = Math.max(0, myTimebank - (elapsed - MOVE_TIME_LIMIT));
        } else {
          currentPlayerTimebank = myTimebank;
        }
      }
    }
  }

  return NextResponse.json({
    // Position — masked during prep for opponent's aux pieces
    fen,

    // Game metadata
    status: game.status,
    prepStartedAt: game.prepStartedAt,
    readyPlayer1: game.readyPlayer1,
    readyPlayer2: game.readyPlayer2,

    // Points
    auxPointsPlayer1: game.auxPointsPlayer1,
    auxPointsPlayer2: game.auxPointsPlayer2,

    // Players
    player1Id: game.player1Id,
    player2Id: game.player2Id,
    isWhite,

    // Move & time state
    moveNumber: game.moveNumber,
    player1Timebank: game.player1Timebank,
    player2Timebank: game.player2Timebank,
    lastMoveAt: game.lastMoveAt,
    lastMoveBy: game.lastMoveBy,

    // Computed from server — clients use these as authoritative source
    isMyTurn,
    timeRemainingOnMove,
    currentPlayerTimebank,

    // Game result (null until finished)
    winnerId: game.winnerId,
    endReason: game.endReason,
    player1EloAfter: game.player1EloAfter,
    player2EloAfter: game.player2EloAfter,
    eloChange: game.eloChange,
  });
}
