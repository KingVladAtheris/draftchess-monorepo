// apps/web/src/app/api/challenges/[id]/route.ts
//
// CHANGES:
//   - Accept path now seeds the Redis game hash immediately after Postgres
//     write, so friend-game prep operations hit Redis on first request.
//   - Double-accept race condition fixed: GameChallenge status update now
//     uses updateMany with a status: "pending" guard (row-count check).
//   - Redis seed call mirrors what the matchmaker does for ranked games.
//   - Added strict input validation for action and draftId.

import { NextRequest, NextResponse }   from "next/server";
import { auth }                        from "@/auth";
import { prisma }                      from "@draftchess/db";
import { checkCsrf }                   from "@/app/lib/csrf";
import { modeAuxPoints, type GameMode, GAMES_PLAYED_FIELD } from "@draftchess/shared/game-modes";
import { publishGameUpdate, getRedisClient } from "@/app/lib/redis-publisher";
import { buildCombinedDraftFen }       from "@draftchess/shared/fen-utils";
import { seedGameState }               from "@draftchess/game-state";
import { logger }                      from "@draftchess/logger";

const log = logger.child({ module: "web:challenges-id" });

const VALID_ACTIONS = new Set(["accept", "decline"]);

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

  const userId = parseInt(session.user.id, 10);
  if (isNaN(userId) || userId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const challengeId = parseInt(id, 10);
  if (isNaN(challengeId) || challengeId <= 0) {
    return NextResponse.json({ error: "Invalid challenge ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action, draftId: rawDraftId } = body as Record<string, unknown>;

  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "action must be accept or decline" }, { status: 400 });
  }

  let acceptorDraftId: number | undefined;
  if (rawDraftId !== undefined && rawDraftId !== null) {
    if (typeof rawDraftId !== "number" || !Number.isInteger(rawDraftId) || rawDraftId <= 0) {
      return NextResponse.json({ error: "draftId must be a positive integer" }, { status: 400 });
    }
    acceptorDraftId = rawDraftId;
  }

  const challenge = await prisma.gameChallenge.findUnique({
    where:  { id: challengeId },
    select: {
      id:            true,
      senderId:      true,
      receiverId:    true,
      mode:          true,
      senderDraftId: true,
      status:        true,
      expiresAt:     true,
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
    log.info({ challengeId, userId }, "challenge declined");
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

  const mode      = challenge.mode as GameMode;
  const auxPoints = modeAuxPoints(mode);

  const senderIsWhite = Math.random() < 0.5;
  const whitePlayerId = senderIsWhite ? challenge.senderId : userId;

  const gamesField = GAMES_PLAYED_FIELD[mode];

  const [sender, receiver] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: challenge.senderId },
      select: {
        eloStandard: true, eloPauper: true, eloRoyal: true,
        gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      },
    }),
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        eloStandard: true, eloPauper: true, eloRoyal: true,
        gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      },
    }),
  ]);

  if (!sender || !receiver) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const eloField      = mode === "standard" ? "eloStandard" : mode === "pauper" ? "eloPauper" : "eloRoyal";
  const p1EloBefore   = sender[eloField];
  const p2EloBefore   = receiver[eloField];
  const p1GamesPlayed = sender[gamesField];
  const p2GamesPlayed = receiver[gamesField];

  // ── Compute combined FEN ────────────────────────────────────────────────────
  let gameFen: string | undefined;
  let whiteDraftFen = "";
  let blackDraftFen = "";

  if (challenge.senderDraftId && acceptorDraftId) {
    const [senderDraft, acceptorDraft] = await Promise.all([
      prisma.draft.findUnique({ where: { id: challenge.senderDraftId }, select: { fen: true } }),
      prisma.draft.findUnique({ where: { id: acceptorDraftId },         select: { fen: true } }),
    ]);

    if (senderDraft?.fen && acceptorDraft?.fen) {
      whiteDraftFen = senderIsWhite ? senderDraft.fen : acceptorDraft.fen;
      blackDraftFen = senderIsWhite ? acceptorDraft.fen : senderDraft.fen;
      gameFen       = buildCombinedDraftFen(whiteDraftFen, blackDraftFen);
    }
  }

  const now = new Date();

  // ── Atomic Postgres write + double-accept guard ───────────────────────────
  let game: { id: number };

  try {
    game = await prisma.$transaction(async (tx) => {
      const guard = await tx.gameChallenge.updateMany({
        where: { id: challengeId, status: "pending" },
        data:  { status: "accepted" },
      });

      if (guard.count === 0) {
        throw new Error("ALREADY_ACCEPTED");
      }

      return tx.game.create({
        data: {
          player1Id:        challenge.senderId,
          player2Id:        userId,
          whitePlayerId,
          mode,
          status:           "prep",
          isFriendGame:     true,
          draft1Id:         challenge.senderDraftId ?? null,
          draft2Id:         acceptorDraftId ?? null,
          fen:              gameFen,
          prepStartedAt:    now,
          auxPointsPlayer1: auxPoints,
          auxPointsPlayer2: auxPoints,
          player1EloBefore: p1EloBefore,
          player2EloBefore: p2EloBefore,
        },
        select: { id: true },
      });
    });
  } catch (err: any) {
    if (err.message === "ALREADY_ACCEPTED") {
      return NextResponse.json({ error: "Challenge is no longer pending" }, { status: 409 });
    }
    throw err;
  }

  // ── Seed Redis game hash immediately ──────────────────────────────────────────
  try {
    const redis = await getRedisClient();
    await seedGameState(redis as any, {
      gameId:        game.id,
      player1Id:     challenge.senderId,
      player2Id:     userId,
      whitePlayerId,
      mode,
      isFriendGame:  true,
      fen:           gameFen ?? "8/8/8/8/8/8/8/4K3 w - - 0 1",
      prepStartedAt: now.getTime(),
      auxPointsPlayer1: auxPoints,
      auxPointsPlayer2: auxPoints,
      player1Timebank:  60_000,
      player2Timebank:  60_000,
      draft1Fen:        whiteDraftFen,
      draft2Fen:        blackDraftFen,
      player1EloBefore:   p1EloBefore,
      player2EloBefore:   p2EloBefore,
      player1GamesPlayed: p1GamesPlayed,
      player2GamesPlayed: p2GamesPlayed,
    });
  } catch (err) {
    log.error({ gameId: game.id, err }, "failed to seed Redis game hash");
  }

  await publishGameUpdate(game.id, {
    status:       "prep",
    isFriendGame: true,
    player1Id:    challenge.senderId,
    player2Id:    userId,
  });

  const redis = await getRedisClient();
  await redis.publish("draftchess:game-events", JSON.stringify({
    type:    "queue-user",
    userId:  challenge.senderId,
    event:   "challenge-accepted",
    payload: { gameId: game.id },
  }));

  log.info({ challengeId, gameId: game.id, userId }, "challenge accepted");

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

  const userId = parseInt(session.user.id, 10);
  if (isNaN(userId) || userId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id }      = await params;
  const challengeId = parseInt(id, 10);
  if (isNaN(challengeId) || challengeId <= 0) {
    return NextResponse.json({ error: "Invalid challenge ID" }, { status: 400 });
  }

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

  log.info({ challengeId, userId }, "challenge cancelled");

  return NextResponse.json({ success: true });
}
