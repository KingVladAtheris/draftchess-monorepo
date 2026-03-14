// src/app/api/drafts/[id]/route.ts
// CHANGES:
//   - Budget enforcement now uses draft.mode to get the correct point limit
//     instead of the hardcoded 33.
//   - Returns `mode` and `budget` in GET response so the editor can display them.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";
import { consume, draftLimiter } from "@/app/lib/rate-limit";
import { modeBudget, type GameMode } from "@draftchess/shared/game-modes";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId  = parseInt(session.user.id);
  const draftId = parseInt(id);

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
  const userId  = parseInt(session.user.id);
  const draftId = parseInt(id);

  const limited = await consume(draftLimiter, req, userId.toString());
  if (limited) return limited;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { fen, points, name } = body;
  if (typeof fen !== "string" || typeof points !== "number") {
    return NextResponse.json({ error: "fen and points required" }, { status: 400 });
  }

  // Load the draft to determine its mode's budget
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
      fen,
      points,
      ...(typeof name === "string" ? { name: name.trim() || null } : {}),
    },
  });

  if (updated.count === 0) return NextResponse.json({ error: "Draft not found or not owned" }, { status: 404 });

  return NextResponse.json({ success: true });
}
