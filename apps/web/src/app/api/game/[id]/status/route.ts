// apps/web/src/app/api/game/[id]/status/route.ts
//
// Returns the current game state for the requesting player.
// Reads from Redis (fast path) with Postgres fallback via loadGameState.
// For finished games (not in Redis), reads from Postgres directly.
// Applies FEN masking during prep so neither player sees the other's aux pieces.
//
// CHANGE: For finished games, returns rematchOfferedBy / rematchSourceGameId
// so ClientGame can seed rematchSourceGameId on page load — fixing the stale
// source ID bug after a browser refresh.

import { NextRequest, NextResponse }   from "next/server";
import { auth }                        from "@/auth";
import { prisma }                      from "@draftchess/db";
import { loadGameState, getGameState } from "@draftchess/game-state";
import {
  buildCombinedDraftFen,
  maskOpponentAuxPlacements,
} from "@draftchess/shared/fen-utils";
import { getRedisClient }              from "@/app/lib/redis-publisher";
import { logger }                      from "@draftchess/logger";

const log = logger.child({ module: "web:status-route" });

const MOVE_TIME_LIMIT = 30_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id }  = await params;
  const userId  = parseInt(session.user.id, 10);
  const gameId  = parseInt(id, 10);

  if (isNaN(userId) || userId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isNaN(gameId) || gameId <= 0) {
    return NextResponse.json({ error: "Invalid game ID" }, { status: 400 });
  }

  const redis = await getRedisClient();

  // ── Try Redis first ─────────────────────────────────────────────────────
  const state = await loadGameState(redis, gameId);

  // ── Finished game — read from Postgres ──────────────────────────────────
  if (state === "finished") {
    return getFinishedGameStatus(redis, gameId, userId);
  }

  // ── Game not found ──────────────────────────────────────────────────────
  if (!state) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  // ── Participant check ───────────────────────────────────────────────────
  if (state.player1Id !== userId && state.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a participant in this game" }, { status: 403 });
  }

  const isWhite   = state.whitePlayerId === userId;
  const isPlayer1 = state.player1Id === userId;

  // ── FEN masking during prep ─────────────────────────────────────────────
  let fen = state.fen;
  if (state.status === "prep" && state.draft1Fen && state.draft2Fen) {
    const originalFen = buildCombinedDraftFen(state.draft1Fen, state.draft2Fen);
    fen = maskOpponentAuxPlacements(state.fen, originalFen, isWhite);
  }

  // ── Timer calculation ───────────────────────────────────────────────────
  let timeRemainingOnMove   = MOVE_TIME_LIMIT;
  let isMyTurn              = false;
  let currentPlayerTimebank: number | null = null;

  if (state.status === "active" && state.lastMoveAt > 0) {
    const fenTurn = fen.split(" ")[1];
    isMyTurn = (fenTurn === "w" && isWhite) || (fenTurn === "b" && !isWhite);
    const elapsed = Date.now() - state.lastMoveAt;
    if (isMyTurn) {
      timeRemainingOnMove = Math.max(0, MOVE_TIME_LIMIT - elapsed);
      const myTimebank    = isPlayer1 ? state.player1Timebank : state.player2Timebank;
      currentPlayerTimebank = elapsed > MOVE_TIME_LIMIT
        ? Math.max(0, myTimebank - (elapsed - MOVE_TIME_LIMIT))
        : myTimebank;
    }
  }

  return NextResponse.json({
    fen,
    status:        state.status,
    prepStartedAt: state.prepStartedAt > 0 ? new Date(state.prepStartedAt).toISOString() : null,
    readyPlayer1:  state.readyPlayer1,
    readyPlayer2:  state.readyPlayer2,
    auxPointsPlayer1: state.auxPointsPlayer1,
    auxPointsPlayer2: state.auxPointsPlayer2,
    player1Id:     state.player1Id,
    player2Id:     state.player2Id,
    isWhite,
    moveNumber:    state.moveNumber,
    player1Timebank: state.player1Timebank,
    player2Timebank: state.player2Timebank,
    lastMoveAt:    state.lastMoveAt > 0 ? new Date(state.lastMoveAt).toISOString() : null,
    lastMoveBy:    state.lastMoveBy > 0 ? state.lastMoveBy : null,
    isMyTurn,
    timeRemainingOnMove,
    currentPlayerTimebank,
    // Not available from Redis for active games — null until finished
    winnerId:        null,
    endReason:       null,
    player1EloAfter: null,
    player2EloAfter: null,
    eloChange:       null,
    // Rematch state — only relevant after the game ends, but returned here
    // for symmetry with the finished path. Active games always have 0.
    rematchOfferedBy:   state.rematchRequestedBy ?? 0,
    rematchOfferedAt:   state.rematchOfferedAt   ?? 0,
    rematchSourceGameId: state.rematchRequestedBy ? gameId : null,
  });
}

// ── Finished game path — reads from Postgres + Redis rematch state ────────────
async function getFinishedGameStatus(
  redis: any,
  gameId: number,
  userId: number,
): Promise<NextResponse> {
  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      status:          true,
      fen:             true,
      player1Id:       true,
      player2Id:       true,
      whitePlayerId:   true,
      moveNumber:      true,
      player1Timebank: true,
      player2Timebank: true,
      lastMoveAt:      true,
      lastMoveBy:      true,
      winnerId:        true,
      endReason:       true,
      player1EloAfter: true,
      player2EloAfter: true,
      eloChange:       true,
    },
  });

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a participant in this game" }, { status: 403 });
  }

  const isWhite = game.whitePlayerId === userId;

  // ── Read rematch state from Redis if the hash still exists ───────────────
  // The hash lives for 4 hours after the game ends. If it's expired, we
  // return zeroes — the accept route's slow-path scan covers that case.
  let rematchOfferedBy   = 0;
  let rematchOfferedAt   = 0;
  let rematchSourceGameId: number | null = null;

  try {
    const redisState = await getGameState(redis, gameId);
    if (redisState && redisState.rematchRequestedBy !== 0) {
      rematchOfferedBy    = redisState.rematchRequestedBy;
      rematchOfferedAt    = redisState.rematchOfferedAt;
      rematchSourceGameId = gameId;
    }
  } catch {
    // Non-fatal — rematch state is best-effort for the status API
  }

  return NextResponse.json({
    fen:           game.fen ?? "",
    status:        game.status,
    prepStartedAt: null,
    readyPlayer1:  true,
    readyPlayer2:  true,
    auxPointsPlayer1: 0,
    auxPointsPlayer2: 0,
    player1Id:     game.player1Id,
    player2Id:     game.player2Id,
    isWhite,
    moveNumber:    game.moveNumber,
    player1Timebank: game.player1Timebank,
    player2Timebank: game.player2Timebank,
    lastMoveAt:    game.lastMoveAt?.toISOString() ?? null,
    lastMoveBy:    game.lastMoveBy ?? null,
    isMyTurn:      false,
    timeRemainingOnMove: 0,
    currentPlayerTimebank: null,
    winnerId:        game.winnerId ?? null,
    endReason:       game.endReason ?? null,
    player1EloAfter: game.player1EloAfter ?? null,
    player2EloAfter: game.player2EloAfter ?? null,
    eloChange:       game.eloChange ?? null,
    rematchOfferedBy,
    rematchOfferedAt,
    rematchSourceGameId,
  });
}
