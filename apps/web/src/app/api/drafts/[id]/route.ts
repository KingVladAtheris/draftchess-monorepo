// apps/web/src/app/api/drafts/[id]/route.ts
// CHANGES:
//   - Budget enforcement now uses draft.mode to get the correct point limit
//     instead of the hardcoded 33.
//   - Returns `mode` and `budget` in GET response so the editor can display them.
//   - Added integer guards on params and body fields.

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/auth";
import { prisma }                    from "@draftchess/db";
import { checkCsrf }                 from "@/app/lib/csrf";
import { consume, draftLimiter }     from "@/app/lib/rate-limit";
import { modeBudget, type GameMode } from "@draftchess/shared/game-modes";
import { logger }                    from "@draftchess/logger";

const log = logger.child({ module: "web:drafts-id" });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId  = parseInt(session.user.id, 10);
  const draftId = parseInt(id, 10);

  if (isNaN(userId) || userId <= 0) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isNaN(draftId) || draftId <= 0) return NextResponse.json({ error: "Invalid draft ID" }, { status: 400 });

  const draft = await prisma.draft.findFirst({
    where:  { id: draftId, userId },
    select: { id: true, name: true, fen: true, points: true, mode: true, updatedAt: true },
  });

  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const mode   = (draft.mode ?? "standard") as GameMode;
  const budget = modeBudget(mode);

  return NextResponse.json({ ...draft, mode, budget });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId  = parseInt(session.user.id, 10);
  const draftId = parseInt(id, 10);

  if (isNaN(userId) || userId <= 0) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isNaN(draftId) || draftId <= 0) return NextResponse.json({ error: "Invalid draft ID" }, { status: 400 });

  const limited = await consume(draftLimiter, req, userId.toString());
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { fen, points, name } = body as Record<string, unknown>;

  if (typeof fen !== "string" || fen.trim().length === 0) {
    return NextResponse.json({ error: "fen must be a non-empty string" }, { status: 400 });
  }
  if (typeof points !== "number" || !Number.isInteger(points) || points < 0) {
    return NextResponse.json({ error: "points must be a non-negative integer" }, { status: 400 });
  }

  const draft = await prisma.draft.findFirst({
    where:  { id: draftId, userId },
    select: { mode: true },
  });

  if (!draft) return NextResponse.json({ error: "Draft not found or not owned" }, { status: 404 });

  const mode   = (draft.mode ?? "standard") as GameMode;
  const budget = modeBudget(mode);

  if (points > budget) {
    return NextResponse.json(
      { error: `Draft exceeds ${mode} budget (${points}/${budget} points)` },
      { status: 400 }
    );
  }

  const updated = await prisma.draft.updateMany({
    where: { id: draftId, userId },
    data:  {
      fen:    fen.trim(),
      points,
      ...(typeof name === "string" ? { name: name.trim() || null } : {}),
    },
  });

  if (updated.count === 0) return NextResponse.json({ error: "Draft not found or not owned" }, { status: 404 });

  log.debug({ userId, draftId, mode, points }, "draft saved");

  return NextResponse.json({ success: true });
}
