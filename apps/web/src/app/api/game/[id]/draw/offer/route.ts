// apps/web/src/app/api/game/[id]/draw/offer/route.ts
//
// POST — offer a draw to the opponent.
// Can be offered at any time during an active game.
// Enforces a 3-move cooldown after a decline.
// Rejects if an offer is already pending from either player.

import { NextRequest, NextResponse }        from "next/server";
import { auth }                             from "@/auth";
import { loadGameState, offerDraw }         from "@draftchess/game-state";
import { checkCsrf }                        from "@/app/lib/csrf";
import { getRedisClient, publishGameUpdate } from "@/app/lib/redis-publisher";
import { logger }                           from "@draftchess/logger";

const log = logger.child({ module: "web:draw-offer" });

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

  if (state.player1Id !== userId && state.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  const result = await offerDraw(redis, gameId, userId, state.moveNumber);

  if (!result.ok) {
    if (result.reason === "cooldown") {
      const movesRemaining = 3 - (state.moveNumber - state.drawDeclinedMoveNumber);
      return NextResponse.json(
        { error: `Draw offer on cooldown — ${movesRemaining} move(s) remaining` },
        { status: 429 },
      );
    }
    if (result.reason === "already_offered") {
      return NextResponse.json(
        { error: "A draw offer is already pending" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Game not active" }, { status: 400 });
  }

  // Broadcast to both players
  await publishGameUpdate(gameId, {
    drawOfferedBy: userId,
  });

  log.info({ gameId, userId }, "draw offered");
  return NextResponse.json({ success: true });
}
