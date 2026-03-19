// apps/web/src/app/api/game/[id]/ready/route.ts
// CHANGE: checkCsrf added.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";
import { scheduleTimeoutJob } from "@/app/lib/queues";
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
      id: true, status: true, fen: true,
      player1Id: true, player2Id: true,
      readyPlayer1: true, readyPlayer2: true,
      player1Timebank: true, player2Timebank: true,
    },
  });

  if (!game || game.status !== "prep") {
    return NextResponse.json({ error: "Game not found or not in prep phase" }, { status: 404 });
  }

  const isPlayer1 = userId === game.player1Id;
  const isPlayer2 = userId === game.player2Id;
  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  const readyField    = isPlayer1 ? "readyPlayer1" : "readyPlayer2";
  const alreadyReady  = isPlayer1 ? game.readyPlayer1 : game.readyPlayer2;
  const opponentReady = isPlayer1 ? game.readyPlayer2 : game.readyPlayer1;

  if (alreadyReady) {
    return NextResponse.json({ success: true, message: "Already ready" });
  }

  const now      = new Date();
  const bothReady = opponentReady; // after this update, both will be ready

  if (bothReady) {
    // Transition to active atomically
    const guard = await prisma.game.updateMany({
      where: { id: gameId, status: "prep" },
      data:  {
        [readyField]:    true,
        status:          "active",
        lastMoveAt:      now,
        moveNumber:      0,
        player1Timebank: game.player1Timebank,
        player2Timebank: game.player2Timebank,
      },
    });

    if (guard.count === 0) {
      return NextResponse.json({ success: true, message: "Already started" });
    }

    
    await publishGameUpdate(gameId, {
      status:          "active",
      fen:             game.fen,
      lastMoveAt:      now.toISOString(),
      moveNumber:      0,
      player1Timebank: game.player1Timebank,
      player2Timebank: game.player2Timebank,
      readyPlayer1:    true,
      readyPlayer2:    true,
    });

    await scheduleTimeoutJob(gameId, game.player1Timebank, game.player2Timebank, now, "w");
  } else {
    await prisma.game.update({
      where: { id: gameId },
      data:  { [readyField]: true },
    });

    
    await publishGameUpdate(gameId, { [readyField]: true });
  }

  return NextResponse.json({ success: true });
}