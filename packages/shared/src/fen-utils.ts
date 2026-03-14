// packages/shared/src/fen-utils.ts
// FEN manipulation utilities for Draft Chess.
// ELO helpers have moved to ./elo.ts
import { MIN_ELO } from "./elo"

export function expandFenRow(row: string): string {
  let result = "";
  for (const char of row) {
    if (/\d/.test(char)) {
      result += "1".repeat(parseInt(char, 10));
    } else {
      result += char;
    }
  }
  return result;
}

export function compressFenRow(row: string): string {
  let result = "";
  let count  = 0;
  for (const char of row) {
    if (char === "1") {
      count++;
    } else {
      if (count > 0) {
        result += count;
        count = 0;
      }
      result += char;
    }
  }
  if (count > 0) result += count;
  return result;
}

export function buildCombinedDraftFen(draft1Fen: string, draft2Fen: string): string {
  const w = draft1Fen.split(" ")[0]!.split("/");
  const b = draft2Fen.split(" ")[0]!.split("/");

  const blackRow = (fenRow: string): string =>
    compressFenRow(
      expandFenRow(fenRow)
        .split("")
        .map(c => (/[a-zA-Z]/.test(c) ? c.toLowerCase() : c))
        .reverse()
        .join(""),
    );

  const rows = [
    blackRow(b[7]!),
    blackRow(b[6]!),
    "8", "8", "8", "8",
    w[6]!,
    w[7]!,
  ];

  return rows.join("/") + " w - - 0 1";
}

export function maskOpponentAuxPlacements(
  currentFen: string,
  originalDraftFen: string,
  viewerIsWhite: boolean,
): string {
  const currentRows  = currentFen.split(" ")[0]!.split("/");
  const originalRows = originalDraftFen.split(" ")[0]!.split("/");

  const opponentRowIndices = viewerIsWhite ? [0, 1] : [6, 7];
  const masked = [...currentRows];

  for (const idx of opponentRowIndices) {
    const cur = expandFenRow(currentRows[idx]!);
    const ori = expandFenRow(originalRows[idx]!);
    let row   = "";

    for (let f = 0; f < 8; f++) {
      row += ori[f] !== "1" ? (cur[f] ?? "1") : "1";
    }

    masked[idx] = compressFenRow(row);
  }

  const fenSuffix = currentFen.split(" ").slice(1).join(" ");
  return masked.join("/") + " " + fenSuffix;
}

export function hasIllegalBattery(fen: string, isWhite: boolean): boolean {
  const rows     = fen.split(" ")[0]!.split("/").map(expandFenRow);
  const backIdx  = isWhite ? 7 : 0;
  const frontIdx = isWhite ? 6 : 1;

  for (let file = 0; file < 8; file++) {
    const p1 = rows[backIdx]![file]!.toUpperCase();
    const p2 = rows[frontIdx]![file]!.toUpperCase();
    if (p1 === "1" || p2 === "1") continue;
    if (["Q", "R"].includes(p1) && ["Q", "R"].includes(p2)) return true;
  }

  for (let file = 0; file < 7; file++) {
    const pairs: [string, string][] = [
      [rows[backIdx]![file]!.toUpperCase(),     rows[frontIdx]![file + 1]!.toUpperCase()],
      [rows[backIdx]![file + 1]!.toUpperCase(), rows[frontIdx]![file]!.toUpperCase()],
    ];
    for (const [a, b] of pairs) {
      if (a === "1" || b === "1") continue;
      if (["Q", "B"].includes(a) && ["Q", "B"].includes(b)) return true;
    }
  }

  return false;
}

export function getPieceAt(fen: string, square: string): string {
  const rank      = parseInt(square[1]!, 10);
  const file      = square.charCodeAt(0) - 97;
  const rankIndex = 8 - rank;
  const row       = expandFenRow(fen.split(" ")[0]!.split("/")[rankIndex]!);
  return row[file] ?? "1";
}

export function placePieceOnFen(fen: string, pieceChar: string, square: string): string {
  const rank      = parseInt(square[1]!, 10);
  const fileIndex = square.charCodeAt(0) - 97;
  const fenParts  = fen.split(" ");
  const rows      = fenParts[0]!.split("/");
  const rankIndex = 8 - rank;

  let row = expandFenRow(rows[rankIndex]!);
  row = row.substring(0, fileIndex) + pieceChar + row.substring(fileIndex + 1);
  rows[rankIndex] = compressFenRow(row);

  return rows.join("/") + " " + fenParts.slice(1).join(" ");
}

export { MIN_ELO };