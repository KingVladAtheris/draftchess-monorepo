// apps/web/src/app/api/game/[id]/rematch/decline/route.ts
//
// POST — decline a pending rematch offer.
//
// FIX: publish to each player's personal queue-user-{userId} room instead
// of the game room. After a rematch both players may be on different game
// pages and are no longer in the game-{id} room, so game-room events never
// reach the sender. Personal rooms are always joined for authenticated users.

import { NextRequest, NextResponse }       from "next/server";
import { auth }                            from "@/auth";
import { getGameState, cancelRematch }     from "@draftchess/game-state";
import { checkCsrf }                       from "@/app/lib/csrf";
import { getRedisClient, publishToChannel } from "@/app/lib/redis-publisher";
import { logger }                          from "@draftchess/logger";

const log = logger.child({ module: "web:rematch-decline" });

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

  // Use getGameState directly — the hash may be the minimal rebuilt version
  // from the offer route's fallback path, which loadGameState would try to
  // reseed from Postgres (unnecessary here since we just need rematch fields).
  const state = await getGameState(redis as any, gameId);

  const rematchRequestedBy = state ? state.rematchRequestedBy : 0;

  if (rematchRequestedBy === 0) {
    // Offer already gone — return ok so the client UI still resets cleanly.
    return NextResponse.json({ success: true });
  }

  if (rematchRequestedBy === userId) {
    return NextResponse.json({ error: "You cannot decline your own rematch offer" }, { status: 409 });
  }

  // Clear Redis state
  await cancelRematch(redis as any, gameId);

  // Notify both players via their personal rooms.
  // The sender (rematchRequestedBy) needs to know their offer was declined
  // so their countdown UI clears. Personal rooms are always active for
  // authenticated users regardless of which game page they're on.
  const offererUserId = rematchRequestedBy;

  await Promise.all([
    // Notify the sender their offer was declined
    publishToChannel("draftchess:game-events", {
      type:    "queue-user",
      userId:  offererUserId,
      event:   "game-update",
      payload: { rematchDeclined: true },
    }),
    // Also notify the decliner (themselves) for consistency — their UI
    // already updates optimistically but this keeps both sides in sync.
    publishToChannel("draftchess:game-events", {
      type:    "queue-user",
      userId:  userId,
      event:   "game-update",
      payload: { rematchDeclined: true },
    }),
  ]);

  log.info({ gameId, userId, offererUserId }, "rematch declined");
  return NextResponse.json({ success: true });
}