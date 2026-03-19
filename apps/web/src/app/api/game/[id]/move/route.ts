// apps/web/src/app/api/game/[id]/move/route.ts
// CHANGES from original:
//   - checkCsrf added (Step 3)
//   - publishGameUpdate added alongside emitToGame for Redis fan-out
//   - endReason null→string coercion fixed: condition guards the call site

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { Chess } from "chess.js";
import { updateGameResult } from "@/app/lib/elo-update";
import { type GameMode, GAMES_PLAYED_FIELD } from "@draftchess/shared/game-modes";
import { scheduleTimeoutJob, cancelTimeoutJob } from "@/app/lib/queues";
import { consume, moveLimiter } from "@/app/lib/rate-limit";
import { checkCsrf } from "@/app/lib/csrf";
import { publishGameUpdate } from "@/app/lib/redis-publisher";

const MOVE_TIME_LIMIT         = 30000;
const TIMEBANK_BONUS_INTERVAL = 20;
const TIMEBANK_BONUS_AMOUNT   = 60000;

class DraftChess extends Chess {
  move(moveObj: any, options?: any) {
    const result = super.move(moveObj, options);
    if (result && (result.flags.includes("k") || result.flags.includes("q") || result.flags.includes("e"))) {
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

  const { id } = await params;
  const userId = parseInt(session.user.id);
  const gameId = parseInt(id);

  const limited = await consume(moveLimiter, req, userId.toString());
  if (limited) return limited;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { from, to, promotion } = body;
  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  // ─── Load game ────────────────────────────────────────────────────────────
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      status: true,
      fen: true,
      player1Id: true,
      player2Id: true,
      whitePlayerId: true,
      mode: true,
      isFriendGame: true,
      player1EloBefore: true,
      player2EloBefore: true,
      lastMoveAt: true,
      moveNumber: true,
      player1Timebank: true,
      player2Timebank: true,
      player1: { select: { gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true } },
      player2: { select: { gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true } },
    },
  });

  if (!game || game.status !== "active") {
    return NextResponse.json({ error: "Game is not active" }, { status: 400 });
  }

  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "You are not a participant in this game" }, { status: 403 });
  }

  if (!game.fen) {
    return NextResponse.json({ error: "Game has no position" }, { status: 400 });
  }

  // ─── Turn check ───────────────────────────────────────────────────────────
  const chess    = new DraftChess(game.fen);
  const turn     = chess.turn();
  const isWhite  = game.whitePlayerId === userId;
  const isMyTurn = (turn === "w" && isWhite) || (turn === "b" && !isWhite);

  if (!isMyTurn) {
    return NextResponse.json({ error: "It is not your turn" }, { status: 400 });
  }

  // ─── Time accounting ──────────────────────────────────────────────────────
  const now             = new Date();
  const lastMoveTime    = game.lastMoveAt ? new Date(game.lastMoveAt) : now;
  const elapsedMs       = now.getTime() - lastMoveTime.getTime();
  const isPlayer1       = game.player1Id === userId;
  const currentTimebank = isPlayer1 ? game.player1Timebank : game.player2Timebank;
  const overage         = Math.max(0, elapsedMs - MOVE_TIME_LIMIT);

  if (overage > 0 && currentTimebank - overage <= 0) {
    const winnerId = isPlayer1 ? game.player2Id : game.player1Id;

    const gameMode   = (game.mode ?? "standard") as GameMode;
    const gamesField = GAMES_PLAYED_FIELD[gameMode];
    const result = await updateGameResult(
      gameId, winnerId,
      game.player1Id, game.player2Id,
      game.player1EloBefore ?? 1200, game.player2EloBefore ?? 1200,
      game.player1[gamesField] ?? 0, game.player2[gamesField] ?? 0,
      "timeout", gameMode,
      game.isFriendGame === true
    );

    if (result) {
      await cancelTimeoutJob(gameId);
      await publishGameUpdate(gameId, {
        status: "finished", winnerId, endReason: "timeout",
        player1EloAfter: result.newPlayer1Elo,
        player2EloAfter: result.newPlayer2Elo,
        eloChange:       result.eloChange,
      });
    }

    return NextResponse.json(
      { success: false, error: "Your time has expired", winnerId, endReason: "timeout" },
      { status: 400 }
    );
  }

  // ─── Validate and execute move ────────────────────────────────────────────
  try {
    chess.move({ from, to, promotion: promotion ?? "q" });
  } catch (err: any) {
    return NextResponse.json({ error: `Illegal move: ${err.message}` }, { status: 400 });
  }

  const newFen        = chess.fen();
  const newMoveNumber = game.moveNumber + 1;

  // ─── Game-ending conditions ───────────────────────────────────────────────
  let newStatus: string       = "active";
  let winnerId: number | null = null;
  let endReason: string | null = null;

  if      (chess.isCheckmate())                { newStatus = "finished"; winnerId = userId; endReason = "checkmate"; }
  else if (chess.isStalemate())                { newStatus = "finished"; endReason = "stalemate"; }
  else if (chess.isThreefoldRepetition())      { newStatus = "finished"; endReason = "repetition"; }
  else if (chess.isInsufficientMaterial())     { newStatus = "finished"; endReason = "insufficient_material"; }
  else if (chess.isDraw())                     { newStatus = "finished"; endReason = "draw"; }

  const bonusAwarded  = newMoveNumber % TIMEBANK_BONUS_INTERVAL === 0;
  const timebankField = isPlayer1 ? "player1Timebank" : "player2Timebank";
  const otherField    = isPlayer1 ? "player2Timebank" : "player1Timebank";

  // ─── Persist — guarded on status:'active' ────────────────────────────────
  const persistResult = await prisma.game.updateMany({
    where: { id: gameId, status: "active" },
    data: {
      fen:        newFen,
      lastMoveAt: now,
      lastMoveBy: userId,
      moveNumber: newMoveNumber,
      ...(overage > 0
        ? { [timebankField]: { decrement: overage } }
        : {}
      ),
      ...(bonusAwarded
        ? {
            [timebankField]: { increment: TIMEBANK_BONUS_AMOUNT - (overage > 0 ? overage : 0) },
            [otherField]:    { increment: TIMEBANK_BONUS_AMOUNT },
          }
        : {}
      ),
    },
  });

  if (persistResult.count === 0) {
    return NextResponse.json({ error: "Game already finished" }, { status: 409 });
  }

  // Re-fetch timebanks (Prisma expressions don't return new values inline)
  const updatedGame = await prisma.game.findUnique({
    where:  { id: gameId },
    select: { player1Timebank: true, player2Timebank: true },
  });

  const player1TimebankFinal = updatedGame?.player1Timebank ?? game.player1Timebank;
  const player2TimebankFinal = updatedGame?.player2Timebank ?? game.player2Timebank;

  // ─── ELO update if game ended ─────────────────────────────────────────────
  // endReason is guaranteed non-null here because newStatus === "finished"
  // only when one of the chess.is*() checks above set it to a string.
  let eloResult: { newPlayer1Elo: number; newPlayer2Elo: number; eloChange: number } | null = null;
  if (newStatus === "finished" && endReason !== null) {
    const gameMode2   = (game.mode ?? "standard") as GameMode;
    const gamesField2 = GAMES_PLAYED_FIELD[gameMode2];
    eloResult = await updateGameResult(
      gameId, winnerId,
      game.player1Id, game.player2Id,
      game.player1EloBefore ?? 1200, game.player2EloBefore ?? 1200,
      game.player1[gamesField2] ?? 0, game.player2[gamesField2] ?? 0,
      endReason, gameMode2,
      game.isFriendGame === true
    );
  }

  // ─── Broadcast ────────────────────────────────────────────────────────────
  const newTurn = new DraftChess(newFen).turn();

  const broadcastPayload: Record<string, any> = {
    fen:             newFen,
    moveNumber:      newMoveNumber,
    player1Timebank: player1TimebankFinal,
    player2Timebank: player2TimebankFinal,
    lastMoveAt:      now.toISOString(),
    turn:            newTurn,
    timebankBonusAwarded: bonusAwarded,
  };

  if (newStatus === "finished") {
    broadcastPayload.status    = "finished";
    broadcastPayload.winnerId  = winnerId;
    broadcastPayload.endReason = endReason;
    if (eloResult) {
      broadcastPayload.player1EloAfter = eloResult.newPlayer1Elo;
      broadcastPayload.player2EloAfter = eloResult.newPlayer2Elo;
      broadcastPayload.eloChange       = eloResult.eloChange;
    }
  }

  await publishGameUpdate(gameId, broadcastPayload);

  // ─── Schedule / cancel timeout ────────────────────────────────────────────
  if (newStatus === "finished") {
    await cancelTimeoutJob(gameId);
  } else {
    await scheduleTimeoutJob(gameId, player1TimebankFinal, player2TimebankFinal, now, newTurn);
  }

  return NextResponse.json({
    success:    true,
    fen:        newFen,
    moveNumber: newMoveNumber,
    player1Timebank: player1TimebankFinal,
    player2Timebank: player2TimebankFinal,
    turn:       newTurn,
    timebankBonusAwarded: bonusAwarded,
    ...(newStatus === "finished" && {
      status:   "finished",
      winnerId,
      isDraw:   winnerId === null,
      endReason,
    }),
  });
}
