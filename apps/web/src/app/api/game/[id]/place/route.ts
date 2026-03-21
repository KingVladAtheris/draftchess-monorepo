// apps/web/src/app/api/game/[id]/place/route.ts
//
// Places an aux piece during the prep phase.
// Reads game state from Redis, validates placement server-side,
// then uses the placePiece Lua script for atomic points-check and FEN update.
// Publishes the raw (unmasked) FEN — the socket server's subscriber applies
// per-player masking before forwarding to each client.

import { NextRequest, NextResponse }   from "next/server";
import { auth }                        from "@/auth";
import {
  loadGameState,
  placePiece,
} from "@draftchess/game-state";
import {
  getPieceAt,
  placePieceOnFen,
  hasIllegalBattery,
} from "@draftchess/shared/fen-utils";
import { consume, placeLimiter }       from "@/app/lib/rate-limit";
import { checkCsrf }                   from "@/app/lib/csrf";
import { getRedisClient, publishGameUpdate } from "@/app/lib/redis-publisher";
import { logger }                      from "@draftchess/logger";

const log = logger.child({ module: "web:place-route" });

const PIECE_VALUES: Record<string, number> = { P: 1, N: 3, B: 3, R: 5 };

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
  const userId  = parseInt(session.user.id);
  const gameId  = parseInt(id);

  const limited = await consume(placeLimiter, req, userId.toString());
  if (limited) return limited;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { piece, square } = body;
  if (!piece || !square) {
    return NextResponse.json({ error: "piece and square required" }, { status: 400 });
  }

  const redis = await getRedisClient();

  // ── Load game state from Redis ──────────────────────────────────────────
  const state = await loadGameState(redis, gameId);

  if (!state || state === "finished") {
    return NextResponse.json({ error: "Invalid game state" }, { status: 400 });
  }

  if (state.status !== "prep") {
    return NextResponse.json({ error: "Invalid game state" }, { status: 400 });
  }

  if (state.player1Id !== userId && state.player2Id !== userId) {
    return NextResponse.json({ error: "Not participant" }, { status: 403 });
  }

  const isWhite   = state.whitePlayerId === userId;
  const isPlayer1 = state.player1Id === userId;

  // ── Validate piece type ─────────────────────────────────────────────────
  const value = PIECE_VALUES[piece.toUpperCase()];
  if (!value) {
    return NextResponse.json({ error: "Invalid piece type" }, { status: 400 });
  }

  // ── Validate square ─────────────────────────────────────────────────────
  const rank      = parseInt(square[1], 10);
  const fileIndex = square.charCodeAt(0) - "a".charCodeAt(0);

  if (isNaN(rank) || isNaN(fileIndex) || fileIndex < 0 || fileIndex > 7) {
    return NextResponse.json({ error: "Invalid square" }, { status: 400 });
  }

  const ownRanks = isWhite ? [1, 2] : [7, 8];
  if (!ownRanks.includes(rank)) {
    return NextResponse.json({ error: "Can only place on own ranks" }, { status: 400 });
  }

  if (piece.toUpperCase() === "P" && rank !== (isWhite ? 2 : 7)) {
    return NextResponse.json({ error: "Pawns can only be placed on the front rank" }, { status: 400 });
  }

  const currentFen = state.fen;

  if (getPieceAt(currentFen, square) !== "1") {
    return NextResponse.json({ error: "Square is already occupied" }, { status: 400 });
  }

  // ── Build new FEN and validate battery rule ─────────────────────────────
  const pieceChar = isWhite ? piece.toUpperCase() : piece.toLowerCase();
  const newFen    = placePieceOnFen(currentFen, pieceChar, square);

  if (hasIllegalBattery(newFen, isWhite)) {
    return NextResponse.json({ error: "Illegal battery — cannot place here" }, { status: 400 });
  }

  // ── Atomic place via Lua script ─────────────────────────────────────────
  // The Lua script atomically checks aux points, decrements them, and
  // updates the FEN. Prevents race conditions between concurrent requests.
  const pointsField = isPlayer1 ? "auxPointsPlayer1" : "auxPointsPlayer2";

  const result = await placePiece(redis, gameId, pointsField, value, newFen);

  if (!result.ok) {
    if (result.reason === "not_prep") {
      return NextResponse.json({ error: "Game is no longer in prep" }, { status: 409 });
    }
    if (result.reason === "insufficient_points") {
      return NextResponse.json({ error: "Not enough auxiliary points" }, { status: 409 });
    }
    return NextResponse.json({ error: "Placement failed" }, { status: 409 });
  }

  // ── Broadcast raw FEN ───────────────────────────────────────────────────
  // The socket server subscriber applies maskOpponentAuxPlacements per player.
  const newAuxPoints = result.newAuxPoints;
  await publishGameUpdate(gameId, {
    fen: newFen,
    ...(isPlayer1
      ? { auxPointsPlayer1: newAuxPoints }
      : { auxPointsPlayer2: newAuxPoints }
    ),
  });

  return NextResponse.json({ success: true });
}
