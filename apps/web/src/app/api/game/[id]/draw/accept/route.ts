// apps/web/src/app/api/game/[id]/draw/accept/route.ts
//
// POST — accept a pending draw offer.
// Marks the game finished in Redis then delegates to the matchmaker
// via draftchess:game-ended, exactly like resignation.

import { NextRequest, NextResponse }             from "next/server";
import { auth }                                  from "@/auth";
import {
  loadGameState,
  markGameFinished,
} from "@draftchess/game-state";
import { checkCsrf }                             from "@/app/lib/csrf";
import { getRedisClient, publishToChannel }      from "@/app/lib/redis-publisher";
import { logger }                                from "@draftchess/logger";
import type { GameEndedPayload }                 from "@/app/lib/game-ended-types";

const log = logger.child({ module: "web:draw-accept" });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const { id } = await params;
  const gameId = parseInt(id);

  const redis = await getRedisClient();
  const state = await loadGameState(redis, gameId);

  if (!state || state === "finished") {
    return NextResponse.json({ error: "Game not found or not active" }, { status: 404 });
  }

  if (state.status !== "active") {
    return NextResponse.json({ error: "Game not found or not active" }, { status: 404 });
  }

  const isPlayer1 = state.player1Id === userId;
  const isPlayer2 = state.player2Id === userId;

  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  // Must be the non-offering player accepting
  if (state.drawOfferedBy === 0) {
    return NextResponse.json({ error: "No draw offer is pending" }, { status: 409 });
  }

  if (state.drawOfferedBy === userId) {
    return NextResponse.json({ error: "You cannot accept your own draw offer" }, { status: 409 });
  }

  const marked = await markGameFinished(redis, gameId);

  if (!marked) {
    log.info({ gameId }, "game already finished by another path");
    return NextResponse.json({ success: true });
  }

  const payload: GameEndedPayload = {
    gameId,
    winnerId:           null, // draw
    endReason:          "draw_agreement",
    finalFen:           state.fen,
    source:             "resign-route", // reuse existing source type
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

  log.info({ gameId, userId }, "draw accepted");
  return NextResponse.json({ success: true });
}
