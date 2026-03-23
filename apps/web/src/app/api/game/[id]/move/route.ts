// apps/web/src/app/api/game/[id]/move/route.ts
//
// Validates and applies a chess move.
// Reads game state from Redis (fast path) with Postgres fallback.
// Writes new state to Redis atomically via Lua script.
// Writes a Move row to Postgres for PGN/replay on every move.
// If a terminal position is detected, publishes to draftchess:game-ended
// and lets the matchmaker handle ELO, stats, and Postgres finalization.

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/auth";
import { prisma }                    from "@draftchess/db";
import { Chess, type Square }        from "chess.js";
import {
  loadGameState,
  applyMove,
  markGameFinished,
  getGameState,
} from "@draftchess/game-state";
import { consume, moveLimiter }      from "@/app/lib/rate-limit";
import { checkCsrf }                 from "@/app/lib/csrf";
import { getRedisClient, publishGameUpdate, publishToChannel } from "@/app/lib/redis-publisher";
import { logger }                    from "@draftchess/logger";
import type { GameEndedPayload }     from "@/app/lib/game-ended-types";

const log = logger.child({ module: "web:move-route" });

const MOVE_TIME_LIMIT         = 30_000;
const TIMEBANK_BONUS_INTERVAL = 20;
const TIMEBANK_BONUS_AMOUNT   = 60_000;

const VALID_PROMOTIONS = new Set(["q", "r", "b", "n"]);
// Square format: file a-h, rank 1-8
const SQUARE_RE = /^[a-h][1-8]$/;

class DraftChess extends Chess {
  move(moveObj: any, options?: any) {
    const result = super.move(moveObj, options);
    if (result && (
      result.flags.includes("k") ||
      result.flags.includes("q") ||
      result.flags.includes("e")
    )) {
      super.undo();
      throw new Error("Castling and en passant are not allowed in Draft Chess");
    }
    return result;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

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

  const limited = await consume(moveLimiter, req, userId.toString());
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

  const { from, to, promotion } = body as Record<string, unknown>;

  if (typeof from !== "string" || !SQUARE_RE.test(from)) {
    return NextResponse.json({ error: "Invalid 'from' square" }, { status: 400 });
  }
  if (typeof to !== "string" || !SQUARE_RE.test(to)) {
    return NextResponse.json({ error: "Invalid 'to' square" }, { status: 400 });
  }

  // promotion must be undefined/null or one of q/r/b/n
  const promoStr = promotion == null ? "q" : String(promotion).toLowerCase();
  if (!VALID_PROMOTIONS.has(promoStr)) {
    return NextResponse.json({ error: "Invalid promotion piece" }, { status: 400 });
  }

  const redis = await getRedisClient();

  // ── Load game state from Redis (fast path) ──────────────────────────────
  const state = await loadGameState(redis, gameId);
  if (!state || state === "finished") {
    return NextResponse.json({ error: "Game is not active" }, { status: 400 });
  }
  if (state.status !== "active") {
    return NextResponse.json({ error: "Game is not active" }, { status: 400 });
  }
  if (state.player1Id !== userId && state.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a participant in this game" }, { status: 403 });
  }
  if (!state.fen) {
    return NextResponse.json({ error: "Game has no position" }, { status: 400 });
  }

  // ── Turn check ──────────────────────────────────────────────────────────
  const chess   = new DraftChess(state.fen);
  const turn    = chess.turn();
  const isWhite = state.whitePlayerId === userId;
  const isMyTurn = (turn === "w" && isWhite) || (turn === "b" && !isWhite);

  if (!isMyTurn) {
    return NextResponse.json({ error: "It is not your turn" }, { status: 400 });
  }

  // ── Time accounting ─────────────────────────────────────────────────────
  const now          = Date.now();
  const lastMoveTime = state.lastMoveAt > 0 ? state.lastMoveAt : now;
  const elapsedMs    = now - lastMoveTime;
  const isPlayer1    = state.player1Id === userId;

  const currentTimebank = isPlayer1 ? state.player1Timebank : state.player2Timebank;
  const overage         = Math.max(0, elapsedMs - MOVE_TIME_LIMIT);

  // ── Time expiry check ───────────────────────────────────────────────────
  if (overage > 0 && currentTimebank - overage <= 0) {
    const winnerId = isPlayer1 ? state.player2Id : state.player1Id;

    const marked = await markGameFinished(redis, gameId);
    if (marked) {
      const payload: GameEndedPayload = {
        gameId,
        winnerId,
        endReason:          "timeout",
        finalFen:           state.fen,
        source:             "move-route",
        player1Id:          state.player1Id,
        player2Id:          state.player2Id,
        mode:               state.mode,
        isFriendGame:       state.isFriendGame,
        player1EloBefore:   state.player1EloBefore,
        player2EloBefore:   state.player2EloBefore,
        player1GamesPlayed: state.player1GamesPlayed,
        player2GamesPlayed: state.player2GamesPlayed,
      };
      await publishToChannel("draftchess:game-ended", { ...payload });
    }

    return NextResponse.json(
      { success: false, error: "Your time has expired", winnerId, endReason: "timeout" },
      { status: 400 },
    );
  }

  // ── Validate and execute move ───────────────────────────────────────────
  try {
    chess.move({ from: from as Square, to: to as Square, promotion: promoStr });
  } catch (err: any) {
    return NextResponse.json({ error: `Illegal move: ${err.message}` }, { status: 400 });
  }

  const newFen        = chess.fen();
  const newMoveNumber = state.moveNumber + 1;
  const nowDate       = new Date(now);

  // ── Game-ending conditions ──────────────────────────────────────────────
  let isTerminal       = false;
  let winnerId: number | null = null;
  let endReason: string | null = null;

  if      (chess.isCheckmate())            { isTerminal = true; winnerId = userId; endReason = "checkmate"; }
  else if (chess.isStalemate())            { isTerminal = true; endReason = "stalemate"; }
  else if (chess.isThreefoldRepetition())  { isTerminal = true; endReason = "repetition"; }
  else if (chess.isInsufficientMaterial()) { isTerminal = true; endReason = "insufficient_material"; }
  else if (chess.isDraw())                 { isTerminal = true; endReason = "draw"; }

  // ── Timebank accounting ─────────────────────────────────────────────────
  const bonusAwarded = newMoveNumber % TIMEBANK_BONUS_INTERVAL === 0;
  let newP1Timebank = state.player1Timebank;
  let newP2Timebank = state.player2Timebank;

  if (overage > 0) {
    if (isPlayer1) newP1Timebank = Math.max(0, newP1Timebank - overage);
    else           newP2Timebank = Math.max(0, newP2Timebank - overage);
  }

  if (bonusAwarded) {
    const bonusAfterOverage = TIMEBANK_BONUS_AMOUNT - (overage > 0 ? overage : 0);
    if (isPlayer1) {
      newP1Timebank += bonusAfterOverage;
      newP2Timebank += TIMEBANK_BONUS_AMOUNT;
    } else {
      newP2Timebank += bonusAfterOverage;
      newP1Timebank += TIMEBANK_BONUS_AMOUNT;
    }
  }

  // ── Write to Redis atomically ───────────────────────────────────────────
  const moveResult = await applyMove(
    redis,
    gameId,
    newFen,
    newMoveNumber,
    now,
    userId,
    newP1Timebank,
    newP2Timebank,
  );

  if (!moveResult.ok) {
    return NextResponse.json({ error: "Game already finished" }, { status: 409 });
  }

  // ── Write Move row to Postgres for PGN/replay ───────────────────────────
  const lastMove = chess.history({ verbose: true }).at(-1);
  prisma.move.create({
    data: {
      gameId,
      moveNumber: newMoveNumber,
      from:       from as string,
      to:         to as string,
      promotion:  promoStr !== "q" || (lastMove?.flags ?? "").includes("p") ? promoStr : null,
      san:        lastMove?.san ?? `${from}${to}`,
      fen:        newFen,
    },
  }).catch((err) => log.error({ gameId, moveNumber: newMoveNumber, err: err.message }, "failed to write Move row"));

  // ── Terminal position — delegate to matchmaker ──────────────────────────
  if (isTerminal && endReason !== null) {
    const marked = await markGameFinished(redis, gameId);
    if (marked) {
      const payload: GameEndedPayload = {
        gameId,
        winnerId,
        endReason,
        finalFen:           newFen,
        source:             "move-route",
        player1Id:          state.player1Id,
        player2Id:          state.player2Id,
        mode:               state.mode,
        isFriendGame:       state.isFriendGame,
        player1EloBefore:   state.player1EloBefore,
        player2EloBefore:   state.player2EloBefore,
        player1GamesPlayed: state.player1GamesPlayed,
        player2GamesPlayed: state.player2GamesPlayed,
      };
      await publishToChannel("draftchess:game-ended", { ...payload });
    }
  }

  // ── Broadcast move to all players ───────────────────────────────────────
  const newTurn = new DraftChess(newFen).turn();
  const broadcastPayload: Record<string, any> = {
    fen:             newFen,
    moveNumber:      newMoveNumber,
    player1Timebank: newP1Timebank,
    player2Timebank: newP2Timebank,
    lastMoveAt:      nowDate.toISOString(),
    turn:            newTurn,
    timebankBonusAwarded: bonusAwarded,
  };

  if (isTerminal) {
    broadcastPayload.status    = "finished";
    broadcastPayload.winnerId  = winnerId;
    broadcastPayload.endReason = endReason;
  }

  await publishGameUpdate(gameId, broadcastPayload);

  log.debug({ gameId, userId, moveNumber: newMoveNumber, from, to }, "move applied");

  return NextResponse.json({
    success:         true,
    fen:             newFen,
    moveNumber:      newMoveNumber,
    player1Timebank: newP1Timebank,
    player2Timebank: newP2Timebank,
    turn:            newTurn,
    timebankBonusAwarded: bonusAwarded,
    ...(isTerminal && {
      status:    "finished",
      winnerId,
      isDraw:    winnerId === null,
      endReason,
    }),
  });
}
