// apps/web/src/app/api/game/[id]/draw/cancel/route.ts
//
// POST — cancel your own pending draw offer.
// Does NOT set the cooldown — only a decline from the opponent starts it.

import { NextRequest, NextResponse }         from "next/server";
import { auth }                              from "@/auth";
import { loadGameState, cancelDraw }         from "@draftchess/game-state";
import { checkCsrf }                         from "@/app/lib/csrf";
import { getRedisClient, publishGameUpdate } from "@/app/lib/redis-publisher";
import { logger }                            from "@draftchess/logger";

const log = logger.child({ module: "web:draw-cancel" });

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

  if (state.drawOfferedBy !== userId) {
    return NextResponse.json({ error: "No pending draw offer from you" }, { status: 409 });
  }

  await cancelDraw(redis, gameId, userId);

  await publishGameUpdate(gameId, { drawOfferedBy: 0 } as any);

  log.info({ gameId, userId }, "draw offer cancelled");
  return NextResponse.json({ success: true });
}
