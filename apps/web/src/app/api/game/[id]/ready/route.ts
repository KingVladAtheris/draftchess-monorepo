// apps/web/src/app/api/game/[id]/ready/route.ts
//
// FIX: When both players are ready, the Postgres game row must be updated
// to status='active' here. Previously the ready route only updated Redis
// (via the markReady Lua script) and published draftchess:game-started,
// leaving Postgres stuck at status='prep'. finalizeGame() guards on
// WHERE status='active' in Postgres, so it returned count=0 every time
// and the game never finalized — players stayed in_game forever.
//
// The prep worker also writes prep→active at 62s, but that is a fallback
// for when players do NOT ready up, not the primary path. When both players
// ready before the timer fires, this route owns the Postgres transition.

import { NextRequest, NextResponse }        from "next/server";
import { auth }                             from "@/auth";
import { prisma }                           from "@draftchess/db";
import { loadGameState, markReady }         from "@draftchess/game-state";
import { checkCsrf }                        from "@/app/lib/csrf";
import {
  getRedisClient,
  publishGameUpdate,
  publishToChannel,
} from "@/app/lib/redis-publisher";
import { logger }                           from "@draftchess/logger";

const log = logger.child({ module: "web:ready-route" });

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

  const userId  = parseInt(session.user.id);
  const { id }  = await params;
  const gameId  = parseInt(id);

  const redis = await getRedisClient();

  const state = await loadGameState(redis, gameId);

  if (!state || state === "finished") {
    return NextResponse.json({ error: "Game not found or not in prep phase" }, { status: 404 });
  }

  if (state.status !== "prep") {
    return NextResponse.json({ error: "Game not found or not in prep phase" }, { status: 404 });
  }

  const isPlayer1 = userId === state.player1Id;
  const isPlayer2 = userId === state.player2Id;

  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  const now             = Date.now();
  const player1Timebank = 60_000;
  const player2Timebank = 60_000;

  // Mark ready atomically in Redis.
  // If bothReady=true, the Lua script has already written status='active'
  // to the Redis hash. We then mirror that to Postgres below.
  const result = await markReady(
    redis,
    gameId,
    isPlayer1,
    now,
    player1Timebank,
    player2Timebank,
  );

  if (!result.ok) {
    if (result.reason === "already_ready") {
      return NextResponse.json({ success: true, message: "Already ready" });
    }
    if (result.reason === "not_prep") {
      return NextResponse.json({ success: true, message: "Already started" });
    }
    return NextResponse.json({ error: "Failed to mark ready" }, { status: 409 });
  }

  if (result.bothReady) {
    log.info({ gameId }, "both players ready — transitioning to active");

    const nowDate = new Date(now);

    // Write prep→active to Postgres.
    // Use updateMany with a status guard so this is idempotent — if the prep
    // worker fires at 62s before this write (unlikely but possible under load),
    // count=0 and we skip without error. The game is already active either way.
    const guard = await prisma.game.updateMany({
      where: { id: gameId, status: "prep" },
      data: {
        status:          "active",
        lastMoveAt:      nowDate,
        moveNumber:      0,
        player1Timebank,
        player2Timebank,
      },
    });

    if (guard.count === 0) {
      // Prep worker beat us or another ready call already ran — fine, game is active.
      log.info({ gameId }, "prep→active guard returned 0 — already transitioned");
    }

    await publishGameUpdate(gameId, {
      status:          "active",
      fen:             state.fen,
      lastMoveAt:      nowDate.toISOString(),
      moveNumber:      0,
      player1Timebank,
      player2Timebank,
      readyPlayer1:    true,
      readyPlayer2:    true,
    });

    // Notify matchmaker to schedule the initial timeout job.
    await publishToChannel("draftchess:game-started", {
      gameId,
      player1Id:       state.player1Id,
      whitePlayerId:   state.whitePlayerId,
      player1Timebank,
      player2Timebank,
      lastMoveAt:      nowDate.toISOString(),
      fenTurn:         "w",
    });

  } else {
    const readyField = isPlayer1 ? "readyPlayer1" : "readyPlayer2";
    await publishGameUpdate(gameId, { [readyField]: true });
  }

  return NextResponse.json({ success: true });
}