// packages/shared/src/elo.ts

/**
 * ELO floor — no player can drop below this rating.
 * Shared by elo-update.ts (web), finalize.ts (matchmaker), and fen-utils.ts.
 */
export const MIN_ELO = 100;

/**
 * ELO calculation using the standard Elo formula.
 * kFactor scales down as the player becomes more established:
 *   < 30 games  → K=32  (provisional)
 *   < 100 games → K=24  (developing)
 *   ≥ 100 games → K=16  (established)
 *
 * The loser change is floored so the loser cannot drop below MIN_ELO.
 * The winner always gains — the floor only applies to the loser.
 */
export function calculateEloChange(
  winnerElo: number,
  loserElo: number,
  winnerGames: number,
  isDraw: boolean = false,
): { winnerChange: number; loserChange: number } {
  const kFactor     = winnerGames < 30 ? 32 : winnerGames < 100 ? 24 : 16;
  const expectedWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));

  const actualWinner = isDraw ? 0.5 : 1;
  const actualLoser  = isDraw ? 0.5 : 0;

  const rawWinnerChange = Math.round(kFactor * (actualWinner - expectedWin));
  const rawLoserChange  = Math.round(kFactor * (actualLoser  - (1 - expectedWin)));

  return {
    winnerChange: rawWinnerChange,
    loserChange:  Math.max(rawLoserChange, MIN_ELO - loserElo),
  };
}