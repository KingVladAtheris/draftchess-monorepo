// apps/web/src/app/api/game/[id]/watch/route.ts
//
// Public endpoint — no auth required.
// Returns current game state for spectators.
//
// Prep phase: returns the original combined draft FEN with NO aux placements
// visible. Spectators see only the base draft pieces, not what either player
// has placed. This prevents cheating via spectator view.
//
// Active/finished: returns the full FEN as-is.

import { NextRequest, NextResponse }  from "next/server";
import { prisma }                     from "@draftchess/db";
import { loadGameState }              from "@draftchess/game-state";
import { getRedisClient }             from "@/app/lib/redis-publisher";
import { buildCombinedDraftFen }      from "@draftchess/shared/fen-utils";

const MOVE_TIME_LIMIT = 30_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gameId = parseInt(id);

  if (isNaN(gameId)) {
    return NextResponse.json({ error: "Invalid game ID" }, { status: 400 });
  }

  const redis = await getRedisClient();
  const state = await loadGameState(redis, gameId);

  // ── Finished game — read from Postgres ──────────────────────────────────────
  if (state === "finished") {
    const game = await prisma.game.findUnique({
      where:  { id: gameId },
      select: {
        fen:             true,
        status:          true,
        mode:            true,
        player1Id:       true,
        player2Id:       true,
        whitePlayerId:   true,
        moveNumber:      true,
        winnerId:        true,
        endReason:       true,
        player1EloAfter: true,
        player2EloAfter: true,
        eloChange:       true,
        player1EloBefore: true,
        player2EloBefore: true,
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
      },
    });

    if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

    return NextResponse.json({
      status:        "finished",
      fen:           game.fen ?? "",
      mode:          game.mode,
      moveNumber:    game.moveNumber,
      player1:       game.player1,
      player2:       game.player2,
      whitePlayerId: game.whitePlayerId,
      winnerId:      game.winnerId ?? null,
      endReason:     game.endReason ?? null,
      player1EloAfter:  game.player1EloAfter ?? null,
      player2EloAfter:  game.player2EloAfter ?? null,
      eloChange:        game.eloChange ?? null,
      // Not needed for spectator but useful for replay
      player1EloBefore: game.player1EloBefore ?? null,
      player2EloBefore: game.player2EloBefore ?? null,
      isSpectator:   true,
    });
  }

  // ── Game not found ──────────────────────────────────────────────────────────
  if (!state) {
    // Could be a very old finished game not in Redis — check Postgres
    const game = await prisma.game.findUnique({
      where:  { id: gameId },
      select: { status: true },
    });
    if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
    // If it exists but isn't in Redis, redirect to finished path
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  // ── Prep phase — hide all aux placements ────────────────────────────────────
  // Spectators see only the original combined draft FEN.
  // Neither player's aux placements are visible.
  let fen = state.fen;
  if (state.status === "prep") {
    if (state.draft1Fen && state.draft2Fen) {
      fen = buildCombinedDraftFen(state.draft1Fen, state.draft2Fen);
    }
  }

  // ── Fetch player usernames ──────────────────────────────────────────────────
  const [player1, player2] = await Promise.all([
    prisma.user.findUnique({ where: { id: state.player1Id }, select: { id: true, username: true } }),
    prisma.user.findUnique({ where: { id: state.player2Id }, select: { id: true, username: true } }),
  ]);

  // ── Timer calculation for display ──────────────────────────────────────────
  let timeRemainingOnMove = MOVE_TIME_LIMIT;
  if (state.status === "active" && state.lastMoveAt > 0) {
    timeRemainingOnMove = Math.max(0, MOVE_TIME_LIMIT - (Date.now() - state.lastMoveAt));
  }

  return NextResponse.json({
    status:          state.status,
    fen,
    mode:            state.mode,
    moveNumber:      state.moveNumber,
    player1:         player1 ?? { id: state.player1Id, username: "Player 1" },
    player2:         player2 ?? { id: state.player2Id, username: "Player 2" },
    whitePlayerId:   state.whitePlayerId,
    player1Timebank: state.player1Timebank,
    player2Timebank: state.player2Timebank,
    lastMoveAt:      state.lastMoveAt > 0 ? new Date(state.lastMoveAt).toISOString() : null,
    timeRemainingOnMove,
    prepStartedAt:   state.prepStartedAt > 0 ? new Date(state.prepStartedAt).toISOString() : null,
    winnerId:        null,
    endReason:       null,
    isSpectator:     true,
  });
}
