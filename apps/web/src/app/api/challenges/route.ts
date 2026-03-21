// apps/web/src/app/api/challenges/route.ts
//
// CHANGE: Added challengeLimiter rate limiting — 5 challenges sent per
// user per hour. Keyed by userId so it's per-sender regardless of IP.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";
import { consume, challengeLimiter } from "@/app/lib/rate-limit";
import type { GameMode } from "@draftchess/shared/game-modes";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const senderId = parseInt(session.user.id);

  // Rate limit by userId — prevents spam-challenging after declines.
  const limited = await consume(challengeLimiter, req, senderId.toString());
  if (limited) return limited;

  let body: { receiverId: number; mode: GameMode; draftId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { receiverId, mode, draftId } = body;

  if (!receiverId || !mode) {
    return NextResponse.json({ error: "receiverId and mode are required" }, { status: 400 });
  }

  if (senderId === receiverId) {
    return NextResponse.json({ error: "Cannot challenge yourself" }, { status: 400 });
  }

  const friendship = await prisma.friendRequest.findFirst({
    where: {
      status: "accepted",
      OR: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    },
  });

  if (!friendship) {
    return NextResponse.json({ error: "You must be friends to challenge this player" }, { status: 403 });
  }

  const existing = await prisma.gameChallenge.findFirst({
    where: {
      status: "pending",
      OR: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    },
  });

  if (existing) {
    return NextResponse.json({ error: "A challenge between you two is already pending" }, { status: 409 });
  }

  if (draftId) {
    const draft = await prisma.draft.findUnique({
      where:  { id: draftId },
      select: { userId: true, mode: true },
    });

    if (!draft || draft.userId !== senderId) {
      return NextResponse.json({ error: "Draft not found or not yours" }, { status: 404 });
    }

    if (draft.mode !== mode) {
      return NextResponse.json({ error: "Draft mode does not match challenge mode" }, { status: 400 });
    }
  }

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  const challenge = await prisma.gameChallenge.create({
    data: {
      senderId,
      receiverId,
      mode,
      senderDraftId: draftId ?? null,
      expiresAt,
    },
    select: {
      id:        true,
      mode:      true,
      expiresAt: true,
      sender:    { select: { id: true, username: true } },
    },
  });

  return NextResponse.json({ challenge }, { status: 201 });
}
