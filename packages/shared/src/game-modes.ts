// packages/shared/src/game-modes.ts
// Single source of truth for per-mode constants.
// Replaces the duplicated copies in apps/web and matchmaker.

export type GameMode = "standard" | "pauper" | "royal";

export const MODE_CONFIG: Record<GameMode, {
  draftBudget: number; // total points allowed in a draft
  auxPoints:   number; // aux points each player starts with in a game
  label:       string;
  color:       string; // tailwind text color class
}> = {
  standard: { draftBudget: 33, auxPoints: 6,  label: "Standard", color: "text-amber-400"  },
  pauper:   { draftBudget: 18, auxPoints: 3,  label: "Pauper",   color: "text-sky-400"    },
  royal:    { draftBudget: 48, auxPoints: 12, label: "Royal",    color: "text-purple-400" },
};

export function modeBudget(mode: GameMode): number {
  return MODE_CONFIG[mode].draftBudget;
}

export function modeAuxPoints(mode: GameMode): number {
  return MODE_CONFIG[mode].auxPoints;
}

// ELO field names — keeps elo-update.ts (web) and finalize.ts (matchmaker) in sync
export const ELO_FIELD: Record<GameMode, "eloStandard" | "eloPauper" | "eloRoyal"> = {
  standard: "eloStandard",
  pauper:   "eloPauper",
  royal:    "eloRoyal",
};

export const GAMES_PLAYED_FIELD: Record<
  GameMode,
  "gamesPlayedStandard" | "gamesPlayedPauper" | "gamesPlayedRoyal"
> = {
  standard: "gamesPlayedStandard",
  pauper:   "gamesPlayedPauper",
  royal:    "gamesPlayedRoyal",
};

export const WINS_FIELD: Record<GameMode, "winsStandard" | "winsPauper" | "winsRoyal"> = {
  standard: "winsStandard",
  pauper:   "winsPauper",
  royal:    "winsRoyal",
};

export const LOSSES_FIELD: Record<
  GameMode,
  "lossesStandard" | "lossesPauper" | "lossesRoyal"
> = {
  standard: "lossesStandard",
  pauper:   "lossesPauper",
  royal:    "lossesRoyal",
};

export const DRAWS_FIELD: Record<GameMode, "drawsStandard" | "drawsPauper" | "drawsRoyal"> = {
  standard: "drawsStandard",
  pauper:   "drawsPauper",
  royal:    "drawsRoyal",
};