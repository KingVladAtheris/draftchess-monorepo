// apps/web/src/app/api/game/[id]/rematch/offer/route.ts
//
// POST — offer a rematch after a finished game.
// Stores the offer in the Redis game hash with a timestamp.
// The 30-second expiry is enforced on the accept side.
// If one player navigates away, the disconnect handler cancels the offer.
//
// FIX: replaced dynamic import() calls (which caused Next.js CJS warning)
// with static imports at the top of the file.
// Simplified fallback path: Postgres check first, then Lua script, then
// direct updateGameState if the hash was already deleted by finalizeGame.

import { NextRequest, NextResponse }         from "next/server";
import { auth }                              from "@/auth";
import { prisma }                            from "@draftchess/db";
import {
  offerRematch,
  updateGameState,
} from "@draftchess/game-state";
import { checkCsrf }                         from "@/app/lib/csrf";
import { getRedisClient, publishGameUpdate } from "@/app/lib/redis-publisher";
import { logger }                            from "@draftchess/logger";

const log = logger.child({ module: "web:rematch-offer" });

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

  // Verify from Postgres first — source of truth for finished status
  // and participant check, regardless of whether the Redis hash still exists.
  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: { status: true, player1Id: true, player2Id: true },
  });

  if (!game || game.status !== "finished") {
    return NextResponse.json({ error: "Game not found or not finished" }, { status: 404 });
  }

  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  // Try the Lua script — works when the game hash is still in Redis
  // (briefly after finalization before the 4-hour TTL or explicit delete).
  const luaResult = await offerRematch(redis as any, gameId, userId);

  if (luaResult.ok) {
    await publishGameUpdate(gameId, { rematchOfferedBy: userId } as any);
    log.info({ gameId, userId }, "rematch offered");
    return NextResponse.json({ success: true });
  }

  if (luaResult.reason === "already_offered") {
    return NextResponse.json({ error: "A rematch offer is already pending" }, { status: 409 });
  }

  // reason === "not_finished": hash was deleted by finalizeGame.
  // Write the minimum fields needed for the accept/decline/cancel routes.
  // The accept route only needs player1Id, player2Id, rematchRequestedBy,
  // and rematchOfferedAt — no need to reseed the full game hash.
  const now = Date.now();
  await updateGameState(redis as any, gameId, {
    status:             "finished",
    player1Id:          game.player1Id,
    player2Id:          game.player2Id,
    rematchRequestedBy: userId,
    rematchOfferedAt:   now,
  });

  await publishGameUpdate(gameId, { rematchOfferedBy: userId } as any);

  log.info({ gameId, userId }, "rematch offered (hash rebuilt after finalization)");
  return NextResponse.json({ success: true });
}