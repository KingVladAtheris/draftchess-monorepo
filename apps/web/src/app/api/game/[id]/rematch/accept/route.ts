// apps/web/src/app/api/game/[id]/rematch/accept/route.ts
//
// POST — accept a pending rematch offer.
// The [id] param is a hint — the actual offer may live on a different game
// if the client navigated between rematches. We search the player's recent
// finished games for a pending offer rather than trusting the URL param.

import { NextRequest, NextResponse }              from "next/server";
import { auth }                                   from "@/auth";
import { prisma }                                 from "@draftchess/db";
import {
  getGameState,
  isRematchExpired,
  cancelRematch,
  seedGameState,
} from "@draftchess/game-state";
import { checkCsrf }                              from "@/app/lib/csrf";
import {
  getRedisClient,
  publishToChannel,
} from "@/app/lib/redis-publisher";
import {
  modeAuxPoints,
  type GameMode,
  GAMES_PLAYED_FIELD,
  ELO_FIELD,
} from "@draftchess/shared/game-modes";
import { buildCombinedDraftFen }                  from "@draftchess/shared/fen-utils";
import { logger }                                 from "@draftchess/logger";

const log = logger.child({ module: "web:rematch-accept" });

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
  const hintGameId = parseInt(id);

  const redis = await getRedisClient();

  // ── Find the game with a pending rematch offer ────────────────────────────
  // Try the hinted gameId first (fast path — usually correct).
  // If that has no offer, scan the player's last 10 finished games for one.
  // This handles the case where the client navigated to a new game and lost
  // track of which original game the offer lives on.

  let sourceGameId: number | null = null;
  let rematchRequestedBy = 0;
  let rematchOfferedAt   = 0;

  // Fast path: check hinted game
  const hintState = await getGameState(redis as any, hintGameId);
  if (hintState && hintState.rematchRequestedBy !== 0) {
    sourceGameId       = hintGameId;
    rematchRequestedBy = hintState.rematchRequestedBy;
    rematchOfferedAt   = hintState.rematchOfferedAt;
  }

  // Slow path: scan recent finished games for a pending offer
  if (!sourceGameId) {
    const recentGames = await prisma.game.findMany({
      where: {
        status: "finished",
        OR: [{ player1Id: userId }, { player2Id: userId }],
      },
      orderBy: { createdAt: "desc" },
      take:    10,
      select:  { id: true },
    });

    for (const g of recentGames) {
      if (g.id === hintGameId) continue; // already checked
      const state = await getGameState(redis as any, g.id);
      if (state && state.rematchRequestedBy !== 0) {
        sourceGameId       = g.id;
        rematchRequestedBy = state.rematchRequestedBy;
        rematchOfferedAt   = state.rematchOfferedAt;
        break;
      }
    }
  }

  if (!sourceGameId) {
    return NextResponse.json({ error: "No rematch offer is pending" }, { status: 409 });
  }

  if (rematchRequestedBy === userId) {
    return NextResponse.json({ error: "You cannot accept your own rematch offer" }, { status: 409 });
  }

  if (rematchOfferedAt > 0 && isRematchExpired(rematchOfferedAt)) {
    await cancelRematch(redis as any, sourceGameId);
    return NextResponse.json({ error: "Rematch offer has expired" }, { status: 410 });
  }

  // Load the source game from Postgres for draft IDs, mode, player IDs
  const originalGame = await prisma.game.findUnique({
    where:  { id: sourceGameId },
    select: {
      status:       true,
      mode:         true,
      isFriendGame: true,
      player1Id:    true,
      player2Id:    true,
      draft1Id:     true,
      draft2Id:     true,
    },
  });

  if (!originalGame || originalGame.status !== "finished") {
    return NextResponse.json({ error: "Game not found or not finished" }, { status: 404 });
  }

  if (originalGame.player1Id !== userId && originalGame.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a player in this game" }, { status: 403 });
  }

  // Clear the rematch offer atomically before creating the new game
  await cancelRematch(redis as any, sourceGameId);

  // ── Resolve drafts ────────────────────────────────────────────────────────
  const mode      = originalGame.mode as GameMode;
  const auxPoints = modeAuxPoints(mode);

  const p1DraftId = originalGame.draft1Id;
  const p2DraftId = originalGame.draft2Id;

  if (!p1DraftId || !p2DraftId) {
    return NextResponse.json({ error: "Original game has no drafts — cannot rematch" }, { status: 400 });
  }

  const [draft1, draft2] = await Promise.all([
    prisma.draft.findUnique({ where: { id: p1DraftId }, select: { fen: true } }),
    prisma.draft.findUnique({ where: { id: p2DraftId }, select: { fen: true } }),
  ]);

  if (!draft1?.fen || !draft2?.fen) {
    return NextResponse.json({ error: "Draft not found — it may have been deleted" }, { status: 404 });
  }

  // Re-roll colors
  const player1IsWhite = Math.random() < 0.5;
  const whitePlayerId  = player1IsWhite ? originalGame.player1Id : originalGame.player2Id;
  const whiteDraftFen  = player1IsWhite ? draft1.fen : draft2.fen;
  const blackDraftFen  = player1IsWhite ? draft2.fen : draft1.fen;
  const gameFen        = buildCombinedDraftFen(whiteDraftFen, blackDraftFen);

  // ── Fetch current ELO / games played ─────────────────────────────────────
  const gamesField = GAMES_PLAYED_FIELD[mode];
  const eloField   = ELO_FIELD[mode];

  const [player1, player2] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: originalGame.player1Id },
      select: {
        eloStandard: true, eloPauper: true, eloRoyal: true,
        gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      },
    }),
    prisma.user.findUnique({
      where:  { id: originalGame.player2Id },
      select: {
        eloStandard: true, eloPauper: true, eloRoyal: true,
        gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      },
    }),
  ]);

  if (!player1 || !player2) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const p1EloBefore   = player1[eloField];
  const p2EloBefore   = player2[eloField];
  const p1GamesPlayed = player1[gamesField];
  const p2GamesPlayed = player2[gamesField];

  const now = new Date();

  // ── Create new game ───────────────────────────────────────────────────────
  const newGame = await prisma.game.create({
    data: {
      player1Id:        originalGame.player1Id,
      player2Id:        originalGame.player2Id,
      whitePlayerId,
      mode,
      status:           "prep",
      isFriendGame:     originalGame.isFriendGame,
      draft1Id:         p1DraftId,
      draft2Id:         p2DraftId,
      fen:              gameFen,
      prepStartedAt:    now,
      auxPointsPlayer1: auxPoints,
      auxPointsPlayer2: auxPoints,
      player1EloBefore: p1EloBefore,
      player2EloBefore: p2EloBefore,
    },
    select: { id: true },
  });

  // ── Seed Redis for new game ───────────────────────────────────────────────
  await seedGameState(redis as any, {
    gameId:        newGame.id,
    player1Id:     originalGame.player1Id,
    player2Id:     originalGame.player2Id,
    whitePlayerId,
    mode,
    isFriendGame:  originalGame.isFriendGame,
    fen:           gameFen,
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

  // ── Notify both players to redirect ──────────────────────────────────────
  await Promise.all([
    publishToChannel("draftchess:game-events", {
      type:    "queue-user",
      userId:  originalGame.player1Id,
      event:   "rematch-accepted",
      payload: { gameId: newGame.id },
    }),
    publishToChannel("draftchess:game-events", {
      type:    "queue-user",
      userId:  originalGame.player2Id,
      event:   "rematch-accepted",
      payload: { gameId: newGame.id },
    }),
  ]);

  log.info({ sourceGameId, newGameId: newGame.id, userId }, "rematch accepted");
  return NextResponse.json({ gameId: newGame.id });
}