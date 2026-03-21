// apps/web/src/app/api/queue/join/route.ts
//
// CHANGE: Fixed TOCTOU race condition between the "already in game" check
// and the user status update. Previously, the matchmaker could transition
// the user to in_game between our findFirst and our update, and our update
// would overwrite queueStatus: "in_game" back to "queued".
//
// Fix: the user.update now includes a WHERE queueStatus = "offline" guard
// via updateMany with a count check. If the user was already matched
// (queueStatus changed to "in_game" between our game check and this write),
// updateMany returns count=0 and we return the existing game instead of
// corrupting state.

import { NextRequest, NextResponse }          from "next/server";
import { auth }                               from "@/auth";
import { prisma }                             from "@draftchess/db";
import { consume, queueLimiter }             from "@/app/lib/rate-limit";
import { checkCsrf }                          from "@/app/lib/csrf";
import { publishToChannel }                   from "@/app/lib/redis-publisher";
import { modeBudget, type GameMode }          from "@draftchess/shared/game-modes";
import { logger }                             from "@draftchess/logger";

const log = logger.child({ module: "web:queue-join" });

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { draftId } = body;
  if (!draftId || typeof draftId !== "number") {
    return NextResponse.json({ error: "draftId required" }, { status: 400 });
  }

  try {
    const existingGame = await prisma.game.findFirst({
      where: {
        status: { in: ["active", "prep"] },
        OR: [{ player1Id: userId }, { player2Id: userId }],
      },
      select: { id: true },
    });

    if (existingGame) {
      return NextResponse.json(
        { error: "You are already in a game", gameId: existingGame.id },
        { status: 409 },
      );
    }

    const draft = await prisma.draft.findFirst({
      where:  { id: draftId, userId },
      select: { id: true, mode: true, points: true },
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found or not owned" }, { status: 403 });
    }

    const budget = modeBudget(draft.mode as GameMode);
    if (draft.points > budget) {
      return NextResponse.json(
        { error: `Draft exceeds ${draft.mode} budget (${draft.points}/${budget} points)` },
        { status: 400 },
      );
    }

    const limited = await consume(queueLimiter, req, userId.toString());
    if (limited) return limited;

    // Atomic conditional update: only transition to "queued" if the user is
    // still "offline". If the matchmaker already moved them to "in_game"
    // between the game check above and this write, count=0 and we surface
    // the race as a 409 rather than silently overwriting their state.
    const updated = await prisma.user.updateMany({
      where: { id: userId, queueStatus: "offline" },
      data: {
        queueStatus:   "queued",
        queuedAt:      new Date(),
        queuedDraftId: draftId,
        queuedMode:    draft.mode as GameMode,
      },
    });

    if (updated.count === 0) {
      // User is already queued or in a game — re-check and surface the gameId
      const currentGame = await prisma.game.findFirst({
        where: {
          status: { in: ["active", "prep"] },
          OR: [{ player1Id: userId }, { player2Id: userId }],
        },
        select: { id: true },
      });
      if (currentGame) {
        return NextResponse.json(
          { error: "You are already in a game", gameId: currentGame.id },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Could not join queue — unexpected state" },
        { status: 409 },
      );
    }

    await publishToChannel("draftchess:queue-join", { userId });

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error({ userId, err }, "queue join error");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
