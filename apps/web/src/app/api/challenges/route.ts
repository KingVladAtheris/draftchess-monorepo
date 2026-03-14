// src/app/api/challenges/route.ts
// POST — send a game challenge to a friend.
//
// Rules:
//   - Sender and receiver must be mutual friends (accepted FriendRequest).
//   - No existing pending challenge between this pair in either direction.
//   - The sender must own the draft they nominate (if any).
//   - The draft's mode must match the requested mode.
//   - Challenge expires after 10 minutes.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";
import type { GameMode } from "@draftchess/shared/game-modes";

const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const senderId = parseInt(session.user.id);

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

  // ── Verify friendship ──────────────────────────────────────────────────────
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

  // ── No duplicate pending challenge ────────────────────────────────────────
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

  // ── Validate draft if provided ─────────────────────────────────────────────
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

  // ── Create challenge ───────────────────────────────────────────────────────
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
