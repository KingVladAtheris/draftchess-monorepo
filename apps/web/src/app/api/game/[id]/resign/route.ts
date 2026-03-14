// src/app/api/game/[id]/resign/route.ts
// CHANGE: checkCsrf added.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";
import { cancelTimeoutJob } from "@/app/lib/queues";
import { updateGameResult } from "@/app/lib/elo-update";
import { type GameMode, GAMES_PLAYED_FIELD } from "@draftchess/shared/game-modes";
import { publishGameUpdate } from "@/app/lib/redis-publisher";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const { id } = await params;
  const gameId  = parseInt(id);

  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      id: true, status: true,
      player1Id: true, player2Id: true,
      mode: true,
      isFriendGame: true,
      player1EloBefore: true, player2EloBefore: true,
      player1: { select: { gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true } },
      player2: { select: { gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true } },
    },
  });

  if (!game || game.status !== "active") {
    return NextResponse.json({ error: "Game not found or not active" }, { status: 404 });
  }

  const isPlayer1 = userId === game.player1Id;
  const isPlayer2 = userId === game.player2Id;
  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  const winnerId = isPlayer1 ? game.player2Id : game.player1Id;

  await cancelTimeoutJob(gameId);

  const gameMode   = (game.mode ?? "standard") as GameMode;
  const gamesField = GAMES_PLAYED_FIELD[gameMode];
  const result = await updateGameResult(
    gameId, winnerId,
    game.player1Id, game.player2Id,
    game.player1EloBefore ?? 1200, game.player2EloBefore ?? 1200,
    game.player1[gamesField] ?? 0, game.player2[gamesField] ?? 0,
    "resignation", gameMode,
    game.isFriendGame === true
  );

  if (result) {
    
    await publishGameUpdate(gameId, {
      status:          "finished",
      winnerId,
      endReason:       "resignation",
      player1EloAfter: result.newPlayer1Elo,
      player2EloAfter: result.newPlayer2Elo,
      eloChange:       result.eloChange,
    });
  }

  return NextResponse.json({ success: true });
}
