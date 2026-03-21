// apps/web/src/app/api/queue/status/route.ts
//
// CHANGE: Matched status is now cached in Redis as matched:{userId} with a
// short TTL, so polling clients hit Redis instead of Postgres on each tick.
// The matchmaker writes this key when creating a game (see match.ts changes).
// Falls back to Postgres on Redis miss so the endpoint remains correct
// after a Redis restart.

import { NextResponse }    from "next/server";
import { auth }            from "@/auth";
import { prisma }          from "@draftchess/db";
import { getRedisClient }  from "@/app/lib/redis-publisher";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  // Fast path: check Redis for a cached matched:{userId} key written by the
  // matchmaker when the game was created.
  try {
    const redis  = await getRedisClient();
    const cached = await redis.get(`matched:${userId}`);
    if (cached) {
      const gameId = parseInt(cached);
      if (!isNaN(gameId)) {
        // Verify the game is still active/prep before trusting the cached key.
        // If the game has already finished, delete the stale key immediately
        // rather than waiting for the TTL, and fall through to the Postgres path.
        const game = await prisma.game.findUnique({
          where:  { id: gameId },
          select: { status: true },
        });
        if (game && (game.status === 'prep' || game.status === 'active')) {
          return NextResponse.json({ matched: true, gameId, status: "in_game" });
        }
        // Stale key — delete it and fall through
        await redis.del(`matched:${userId}`).catch(() => {});
      }
    }
  } catch {
    // Redis unavailable — fall through to Postgres
  }

  // Slow path: Postgres
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { queueStatus: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const currentGame = await prisma.game.findFirst({
    where: {
      OR:     [{ player1Id: userId }, { player2Id: userId }],
      status: { in: ["prep", "active"] },
    },
    orderBy: { createdAt: "desc" },
    select:  { id: true },
  });

  const isMatched = user.queueStatus === "in_game" && currentGame != null;

  return NextResponse.json({
    matched: isMatched,
    gameId:  isMatched ? currentGame.id : null,
    status:  user.queueStatus,
  });
}