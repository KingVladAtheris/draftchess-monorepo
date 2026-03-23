// apps/web/src/app/api/challenges/route.ts
//
// CHANGE: on successful challenge creation, writes a Notification row
// for the receiver and publishes to draftchess:notifications so the bell
// updates live without polling.

import { NextRequest, NextResponse }          from "next/server";
import { auth }                               from "@/auth";
import { prisma }                             from "@draftchess/db";
import { checkCsrf }                          from "@/app/lib/csrf";
import { consume, challengeLimiter }          from "@/app/lib/rate-limit";
import { publishNotification }                from "@/app/lib/redis-publisher";
import { MODE_CONFIG, type GameMode }         from "@draftchess/shared/game-modes";
import { logger }                             from "@draftchess/logger";

const log = logger.child({ module: "web:challenges" });

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const VALID_MODES      = new Set<string>(Object.keys(MODE_CONFIG));

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const senderId = parseInt(session.user.id, 10);
  if (isNaN(senderId) || senderId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await consume(challengeLimiter, req, senderId.toString());
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { receiverId, mode, draftId } = body as Record<string, unknown>;

  if (typeof receiverId !== "number" || !Number.isInteger(receiverId) || receiverId <= 0) {
    return NextResponse.json({ error: "receiverId must be a positive integer" }, { status: 400 });
  }
  if (typeof mode !== "string" || !VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "mode must be one of: standard, pauper, royal" }, { status: 400 });
  }
  if (draftId !== undefined && draftId !== null) {
    if (typeof draftId !== "number" || !Number.isInteger(draftId) || draftId <= 0) {
      return NextResponse.json({ error: "draftId must be a positive integer" }, { status: 400 });
    }
  }

  if (senderId === receiverId) {
    return NextResponse.json({ error: "Cannot challenge yourself" }, { status: 400 });
  }

  const validatedMode = mode as GameMode;
  const validatedDraftId = draftId as number | undefined;

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

  if (validatedDraftId) {
    const draft = await prisma.draft.findUnique({
      where:  { id: validatedDraftId },
      select: { userId: true, mode: true },
    });

    if (!draft || draft.userId !== senderId) {
      return NextResponse.json({ error: "Draft not found or not yours" }, { status: 404 });
    }
    if (draft.mode !== validatedMode) {
      return NextResponse.json({ error: "Draft mode does not match challenge mode" }, { status: 400 });
    }
  }

  const sender = await prisma.user.findUnique({
    where:  { id: senderId },
    select: { id: true, username: true, image: true },
  });

  const senderDraft = validatedDraftId
    ? await prisma.draft.findUnique({ where: { id: validatedDraftId }, select: { id: true, name: true } })
    : null;

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  const challenge = await prisma.gameChallenge.create({
    data: {
      senderId,
      receiverId,
      mode: validatedMode,
      senderDraftId: validatedDraftId ?? null,
      expiresAt,
    },
    select: {
      id:        true,
      mode:      true,
      expiresAt: true,
      sender:    { select: { id: true, username: true } },
    },
  });

  const notification = await prisma.notification.create({
    data: {
      userId:  receiverId,
      type:    "challenge",
      payload: {
        challengeId: challenge.id,
        mode:        validatedMode,
        expiresAt:   expiresAt.toISOString(),
        sender:      { id: sender!.id, username: sender!.username, image: sender!.image },
        senderDraft: senderDraft ?? null,
      },
    },
  });

  await publishNotification(receiverId, "challenge", {
    notificationId: notification.id,
    challengeId:    challenge.id,
    mode:           validatedMode,
    expiresAt:      expiresAt.toISOString(),
    sender:         { id: sender!.id, username: sender!.username, image: sender!.image },
    senderDraft:    senderDraft ?? null,
    createdAt:      notification.createdAt.toISOString(),
  });

  log.info({ senderId, receiverId, mode: validatedMode }, "challenge sent");

  return NextResponse.json({ challenge }, { status: 201 });
}
