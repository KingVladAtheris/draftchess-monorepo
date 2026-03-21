// apps/web/src/app/api/game/[id]/resign/route.ts
//
// Handles player resignation.
// Reads game state from Redis, marks game finished atomically,
// then publishes to draftchess:game-ended for the matchmaker to finalize.
// Does NOT call updateGameResult — that function is deleted.

import { NextRequest, NextResponse }          from "next/server";
import { auth }                               from "@/auth";
import {
  loadGameState,
  markGameFinished,
} from "@draftchess/game-state";
import { checkCsrf }                          from "@/app/lib/csrf";
import {
  getRedisClient,
  publishToChannel,
} from "@/app/lib/redis-publisher";
import { logger }                             from "@draftchess/logger";
import type { GameEndedPayload }              from "@/app/lib/game-ended-types";

const log = logger.child({ module: "web:resign-route" });

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

  // ── Load game state from Redis ──────────────────────────────────────────
  const state = await loadGameState(redis, gameId);

  if (!state || state === "finished") {
    return NextResponse.json({ error: "Game not found or not active" }, { status: 404 });
  }

  if (state.status !== "active") {
    return NextResponse.json({ error: "Game not found or not active" }, { status: 404 });
  }

  const isPlayer1 = userId === state.player1Id;
  const isPlayer2 = userId === state.player2Id;

  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  const winnerId = isPlayer1 ? state.player2Id : state.player1Id;

  // ── Mark finished in Redis atomically ───────────────────────────────────
  const marked = await markGameFinished(redis, gameId);

  if (!marked) {
    // Another path already finished the game
    log.info({ gameId }, "game already finished by another path")
    return NextResponse.json({ success: true });
  }

  // ── Delegate finalization to matchmaker ─────────────────────────────────
  const payload: GameEndedPayload = {
    gameId,
    winnerId,
    endReason:          "resignation",
    finalFen:           state.fen,
    source:             "resign-route",
    player1Id:          state.player1Id,
    player2Id:          state.player2Id,
    mode:               state.mode,
    isFriendGame:       state.isFriendGame,
    player1EloBefore:   state.player1EloBefore,
    player2EloBefore:   state.player2EloBefore,
    player1GamesPlayed: state.player1GamesPlayed,
    player2GamesPlayed: state.player2GamesPlayed,
  };

  await publishToChannel("draftchess:game-ended", { ...payload });

  log.info({ gameId, userId, winnerId }, "resignation processed — delegated to matchmaker")

  return NextResponse.json({ success: true });
}
