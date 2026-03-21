// apps/web/src/app/api/game/[id]/draw/decline/route.ts
//
// POST — decline a pending draw offer.
// Records the current move number in Redis so the 3-move cooldown
// is enforced atomically on the next offer attempt.

import { NextRequest, NextResponse }         from "next/server";
import { auth }                              from "@/auth";
import { loadGameState, declineDraw }        from "@draftchess/game-state";
import { checkCsrf }                         from "@/app/lib/csrf";
import { getRedisClient, publishGameUpdate } from "@/app/lib/redis-publisher";
import { logger }                            from "@draftchess/logger";

const log = logger.child({ module: "web:draw-decline" });

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

  if (state.drawOfferedBy === 0) {
    return NextResponse.json({ error: "No draw offer is pending" }, { status: 409 });
  }

  if (state.drawOfferedBy === userId) {
    return NextResponse.json({ error: "You cannot decline your own offer — use cancel instead" }, { status: 409 });
  }

  const result = await declineDraw(redis, gameId, state.moveNumber);

  if (!result.ok) {
    return NextResponse.json({ error: "Failed to decline draw offer" }, { status: 409 });
  }

  await publishGameUpdate(gameId, {
    drawOfferedBy: 0,
    drawDeclined:  true,
  } as any);

  log.info({ gameId, userId }, "draw declined");
  return NextResponse.json({ success: true });
}
