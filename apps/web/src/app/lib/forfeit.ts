// apps/web/src/app/lib/forfeit.ts
// FIXES:
//   - Selects per-mode gamesPlayed fields instead of deleted flat gamesPlayed.
//   - Passes game.mode and game.isFriendGame to updateGameResult.
//   - cancelTimeoutJob is now always called, not only on the result !== null path.
//   - emitToGame replaced with publishGameUpdate for consistency with every
//     other broadcast site. The callback parameter is removed entirely.

import { prisma } from "@draftchess/db";
import { updateGameResult } from "@/app/lib/elo-update";
import { cancelTimeoutJob } from "@/app/lib/queues";
import { publishGameUpdate } from "@/app/lib/redis-publisher";
import { type GameMode, GAMES_PLAYED_FIELD } from "@draftchess/shared/game-modes";

export async function forfeitGame(
  gameId:  number,
  userId:  number,
): Promise<void> {

  const game = await prisma.game.findUnique({
    where:  { id: gameId },
    select: {
      status:           true,
      mode:             true,
      isFriendGame:     true,
      player1Id:        true,
      player2Id:        true,
      player1EloBefore: true,
      player2EloBefore: true,
      player1: {
        select: {
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      },
      player2: {
        select: {
          gamesPlayedStandard: true,
          gamesPlayedPauper:   true,
          gamesPlayedRoyal:    true,
        },
      },
    },
  });

  if (!game) {
    console.warn(`[Forfeit] game ${gameId} not found`);
    return;
  }

  if (game.status !== "active" && game.status !== "prep") {
    console.log(`[Forfeit] game ${gameId} already finished (status: ${game.status}), skipping`);
    return;
  }

  const isPlayer1 = game.player1Id === userId;
  if (!isPlayer1 && game.player2Id !== userId) {
    console.warn(`[Forfeit] user ${userId} is not a participant in game ${gameId}`);
    return;
  }

  // For prep games, promote to active so updateGameResult's guard can fire.
  // updateMany is atomic — if the ready route beat us here, count=0 and we exit.
  if (game.status === "prep") {
    const promoted = await prisma.game.updateMany({
      where: { id: gameId, status: "prep" },
      data:  { status: "active" },
    });
    if (promoted.count === 0) {
      console.log(`[Forfeit] game ${gameId} prep already resolved, skipping`);
      return;
    }
  }

  const winnerId   = isPlayer1 ? game.player2Id : game.player1Id;
  const gameMode   = (game.mode ?? "standard") as GameMode;
  const gamesField = GAMES_PLAYED_FIELD[gameMode];

  // cancelTimeoutJob is idempotent — call it unconditionally so we never
  // leave an orphaned timeout job regardless of what updateGameResult returns.
  await cancelTimeoutJob(gameId);

  const result = await updateGameResult(
    gameId,
    winnerId,
    game.player1Id,
    game.player2Id,
    game.player1EloBefore ?? 1200,
    game.player2EloBefore ?? 1200,
    game.player1[gamesField] ?? 0,
    game.player2[gamesField] ?? 0,
    "abandoned",
    gameMode,
    game.isFriendGame === true,
  );

  if (!result) {
    // updateGameResult saw status != 'active' — another path already finished
    // the game. Queue state was reset there. Nothing left to do.
    console.log(`[Forfeit] game ${gameId} already finished by another path, skipping`);
    return;
  }

  await publishGameUpdate(gameId, {
    status:          "finished",
    winnerId,
    endReason:       "abandoned",
    player1EloAfter: result.newPlayer1Elo,
    player2EloAfter: result.newPlayer2Elo,
    eloChange:       result.eloChange,
  });

  console.log(`[Forfeit] game ${gameId}: user ${userId} forfeited, winner: ${winnerId}`);
}
