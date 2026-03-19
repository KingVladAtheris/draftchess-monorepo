// apps/web/src/app/api/challenges/[id]/route.ts
//
// PATCH { action: "accept" | "decline" }
//   - accept: creates a Game in "prep" status (isFriendGame=true), marks challenge accepted.
//   - decline: marks challenge declined.
//
// DELETE — sender cancels their own pending challenge.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";
import { modeAuxPoints, type GameMode } from "@draftchess/shared/game-modes";
import { publishGameUpdate } from "@/app/lib/redis-publisher";
import { buildCombinedDraftFen } from "@draftchess/shared/fen-utils";

export async function PATCH(
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
  const challengeId = parseInt(id);

  let body: { action: "accept" | "decline"; draftId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action, draftId: acceptorDraftId } = body;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action must be accept or decline" }, { status: 400 });
  }

  const challenge = await prisma.gameChallenge.findUnique({
    where:  { id: challengeId },
    select: {
      id:           true,
      senderId:     true,
      receiverId:   true,
      mode:         true,
      senderDraftId: true,
      status:       true,
      expiresAt:    true,
    },
  });

  if (!challenge || challenge.receiverId !== userId) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  if (challenge.status !== "pending") {
    return NextResponse.json({ error: "Challenge is no longer pending" }, { status: 409 });
  }

  if (new Date() > challenge.expiresAt) {
    await prisma.gameChallenge.update({ where: { id: challengeId }, data: { status: "expired" } });
    return NextResponse.json({ error: "Challenge has expired" }, { status: 410 });
  }

  if (action === "decline") {
    await prisma.gameChallenge.update({ where: { id: challengeId }, data: { status: "declined" } });
    return NextResponse.json({ success: true });
  }

  // ── Accept: validate acceptor's draft if provided ─────────────────────────
  if (acceptorDraftId) {
    const draft = await prisma.draft.findUnique({
      where:  { id: acceptorDraftId },
      select: { userId: true, mode: true },
    });
    if (!draft || draft.userId !== userId) {
      return NextResponse.json({ error: "Draft not found or not yours" }, { status: 404 });
    }
    if (draft.mode !== challenge.mode) {
      return NextResponse.json({ error: "Draft mode does not match challenge mode" }, { status: 400 });
    }
  }

    // ── Accept: create the game ────────────────────────────────────────────────
  const mode = challenge.mode as GameMode;
  const auxPoints = modeAuxPoints(mode);

  // Coin flip for white (identical to matchmaker)
  const senderIsWhite = Math.random() < 0.5;
  const whitePlayerId = senderIsWhite ? challenge.senderId : userId;

  // ── Compute combined FEN exactly like regular matchmaking ─────────────────
  // This is the key change — now friend challenges behave identically.
  let gameFen: string | undefined = undefined;
  if (challenge.senderDraftId && acceptorDraftId) {
    const [senderDraft, acceptorDraft] = await Promise.all([
      prisma.draft.findUnique({
        where: { id: challenge.senderDraftId },
        select: { fen: true },
      }),
      prisma.draft.findUnique({
        where: { id: acceptorDraftId },
        select: { fen: true },
      }),
    ]);

    if (senderDraft?.fen && acceptorDraft?.fen) {
      const whiteFen = senderIsWhite ? senderDraft.fen : acceptorDraft.fen;
      const blackFen = senderIsWhite ? acceptorDraft.fen : senderDraft.fen;
      gameFen = buildCombinedDraftFen(whiteFen, blackFen);
    }
  }

  const [game] = await prisma.$transaction([
    prisma.game.create({
      data: {
        player1Id:        challenge.senderId,
        player2Id:        userId,
        whitePlayerId,
        mode,
        status:           "prep",
        isFriendGame:     true,
        draft1Id:         challenge.senderDraftId ?? null,
        draft2Id:         acceptorDraftId ?? null,
        fen:              gameFen,                    // ← now set, exactly like queue
        prepStartedAt:    new Date(),
        auxPointsPlayer1: auxPoints,
        auxPointsPlayer2: auxPoints,
        player1EloBefore: 0,
        player2EloBefore: 0,
      },
      select: { id: true },
    }),
    prisma.gameChallenge.update({
      where: { id: challengeId },
      data:  { status: "accepted" },
    }),
  ]);

  // Notify challenger via their personal socket room so they get redirected
  // to the game page without needing to refresh.
  await publishGameUpdate(game.id, {
    status:      "prep",
    isFriendGame: true,
    player1Id:   challenge.senderId,
    player2Id:   userId,
  });

  // Also push directly to the challenger's queue-user room
  const { getRedisClient } = await import("@/app/lib/redis-publisher");
  const redis = await getRedisClient();
  await redis.publish("draftchess:game-events", JSON.stringify({
    type:    "queue-user",
    userId:  challenge.senderId,
    event:   "challenge-accepted",
    payload: { gameId: game.id },
  }));

  return NextResponse.json({ gameId: game.id });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId      = parseInt(session.user.id);
  const { id }      = await params;
  const challengeId = parseInt(id);

  const challenge = await prisma.gameChallenge.findUnique({
    where:  { id: challengeId },
    select: { senderId: true, status: true },
  });

  if (!challenge || challenge.senderId !== userId) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  if (challenge.status !== "pending") {
    return NextResponse.json({ error: "Challenge is no longer pending" }, { status: 409 });
  }

  await prisma.gameChallenge.update({ where: { id: challengeId }, data: { status: "cancelled" } });
  return NextResponse.json({ success: true });
}
