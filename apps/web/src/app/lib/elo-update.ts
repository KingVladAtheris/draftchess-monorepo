// apps/web/src/app/lib/elo-update.ts
//
// CHANGES:
//   - Now accepts `mode` parameter and updates the correct per-mode ELO /
//     stats fields (eloStandard/eloPauper/eloRoyal, gamesPlayedStandard, etc.)
//     instead of the removed flat elo/gamesPlayed/wins/losses/draws fields.
//   - ELO floor: neither player can drop below MIN_ELO (100).
//   - Rapid-loss guard unchanged.

import { prisma } from "@draftchess/db";
import { calculateEloChange } from "@draftchess/shared/elo";
import {
  type GameMode,
  ELO_FIELD, GAMES_PLAYED_FIELD, WINS_FIELD, LOSSES_FIELD, DRAWS_FIELD,
} from "@draftchess/shared/game-modes";

const MIN_ELO             = 100;
const MAX_LOSSES_PER_HOUR = 8;

class AlreadyFinishedError extends Error {
  constructor() { super("already_finished"); }
}

async function recentLossCount(userId: number, mode: GameMode): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.game.count({
    where: {
      mode,
      status:    "finished",
      endReason: { not: "draw" },
      winnerId:  { not: userId },
      OR: [{ player1Id: userId }, { player2Id: userId }],
      createdAt: { gte: oneHourAgo },
    },
  });
}

export async function updateGameResult(
  gameId:           number,
  winnerId:         number | null,
  player1Id:        number,
  player2Id:        number,
  player1EloBefore: number,
  player2EloBefore: number,
  player1Games:     number,
  player2Games:     number,
  endReason:        string,
  mode:             GameMode = "standard",
  isFriendGame:     boolean,
): Promise<{ newPlayer1Elo: number; newPlayer2Elo: number; eloChange: number } | null> {

  // Friend games: mark finished, clear queue state, but skip ELO + stats.
  if (isFriendGame) {
    try {
      await prisma.$transaction(async (tx) => {
        const guard = await tx.game.updateMany({
          where: { id: gameId, status: "active" },
          data:  { status: "finished" },
        });
        if (guard.count === 0) throw new AlreadyFinishedError();
        await tx.game.update({
          where: { id: gameId },
          data:  { winnerId: winnerId ?? undefined, endReason },
        });
        for (const uid of [player1Id, player2Id]) {
          await tx.user.update({
            where: { id: uid },
            data:  { queueStatus: "offline", queuedAt: null, queuedDraftId: null, queuedMode: null },
          });
        }
      });
    } catch (err) {
      if (err instanceof AlreadyFinishedError) {
        console.warn(`updateGameResult: game ${gameId} already finished, skipping`);
        return null;
      }
      throw err;
    }
    // Return the unchanged ELOs so callers can broadcast without crashing.
    return { newPlayer1Elo: player1EloBefore, newPlayer2Elo: player2EloBefore, eloChange: 0 };
  }

  const isDraw = winnerId === null;

  // ── Rapid-loss guard ──────────────────────────────────────────────────────
  let p1LossCap = false;
  let p2LossCap = false;

  if (!isDraw) {
    const loserId = winnerId === player1Id ? player2Id : player1Id;
    const losses  = await recentLossCount(loserId, mode);
    if (losses >= MAX_LOSSES_PER_HOUR) {
      console.warn(`[ELO] rapid-loss cap applied for user ${loserId} (${losses} losses in last hour, mode=${mode})`);
      if (loserId === player1Id) p1LossCap = true;
      else                       p2LossCap = true;
    }
  }

  // ── ELO calculation ───────────────────────────────────────────────────────
  let player1EloChange: number;
  let player2EloChange: number;

  if (isDraw) {
    const result = calculateEloChange(player1EloBefore, player2EloBefore, player1Games, true);
    player1EloChange = result.winnerChange;
    player2EloChange = result.loserChange;
  } else if (winnerId === player1Id) {
    const result = calculateEloChange(player1EloBefore, player2EloBefore, player1Games, false);
    player1EloChange = result.winnerChange;
    player2EloChange = p2LossCap ? -1 : result.loserChange;
  } else {
    const result = calculateEloChange(player2EloBefore, player1EloBefore, player2Games, false);
    player2EloChange = result.winnerChange;
    player1EloChange = p1LossCap ? -1 : result.loserChange;
  }

  const newPlayer1Elo = Math.max(MIN_ELO, player1EloBefore + player1EloChange);
  const newPlayer2Elo = Math.max(MIN_ELO, player2EloBefore + player2EloChange);
  const eloChange     = Math.abs(player1EloChange);

  // ── Per-mode field names ──────────────────────────────────────────────────
  const eloField      = ELO_FIELD[mode];
  const gamesField    = GAMES_PLAYED_FIELD[mode];
  const winsField     = WINS_FIELD[mode];
  const lossesField   = LOSSES_FIELD[mode];
  const drawsField    = DRAWS_FIELD[mode];

  try {
    await prisma.$transaction(async (tx) => {
      const guard = await tx.game.updateMany({
        where: { id: gameId, status: "active" },
        data:  { status: "finished" },
      });

      if (guard.count === 0) throw new AlreadyFinishedError();

      await tx.game.update({
        where: { id: gameId },
        data: {
          winnerId:        winnerId ?? undefined,
          player1EloAfter: newPlayer1Elo,
          player2EloAfter: newPlayer2Elo,
          eloChange,
          endReason,
        },
      });

      await tx.user.update({
        where: { id: player1Id },
        data: {
          [eloField]:   newPlayer1Elo,
          [gamesField]: { increment: 1 },
          ...(!isDraw && winnerId === player1Id ? { [winsField]:   { increment: 1 } } : {}),
          ...(!isDraw && winnerId !== player1Id ? { [lossesField]: { increment: 1 } } : {}),
          ...(isDraw                            ? { [drawsField]:  { increment: 1 } } : {}),
          queueStatus:   "offline",
          queuedAt:      null,
          queuedDraftId: null,
          queuedMode:    null,
        },
      });

      await tx.user.update({
        where: { id: player2Id },
        data: {
          [eloField]:   newPlayer2Elo,
          [gamesField]: { increment: 1 },
          ...(!isDraw && winnerId === player2Id ? { [winsField]:   { increment: 1 } } : {}),
          ...(!isDraw && winnerId !== player2Id ? { [lossesField]: { increment: 1 } } : {}),
          ...(isDraw                            ? { [drawsField]:  { increment: 1 } } : {}),
          queueStatus:   "offline",
          queuedAt:      null,
          queuedDraftId: null,
          queuedMode:    null,
        },
      });
    });
  } catch (err) {
    if (err instanceof AlreadyFinishedError) {
      console.warn(`updateGameResult: game ${gameId} already finished, skipping`);
      return null;
    }
    throw err;
  }

  console.log(
    `Game ${gameId} (${mode}) ended: ${endReason}. ` +
    `P1 ${eloField} ${player1EloBefore}→${newPlayer1Elo}, ` +
    `P2 ${eloField} ${player2EloBefore}→${newPlayer2Elo}`
  );

  return { newPlayer1Elo, newPlayer2Elo, eloChange };
}
