// apps/web/src/app/drafts/[id]/ClientDraftEditor.tsx
// CHANGES vs original:
//   - Props extended with `mode: GameMode` and `budget: number`.
//   - `maxPoints = 33` replaced with `budget` prop throughout.
//   - Mode badge shown in sidebar (Standard / Pauper / Royal) with correct colour.
//   - handleSave uses apiFetch() instead of raw fetch() so the CSRF header is sent.
"use client";

import { useState, useMemo } from "react";
import { Chessboard } from "react-chessboard";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api-fetch";
import { MODE_CONFIG, type GameMode } from "@draftchess/shared/game-modes";

type LibraryPiece = {
  name: string;
  value: number;
  fen: string;
  ui: string;
};

type ClientDraftEditorProps = {
  initialFen:    string;
  initialPoints: number;
  draftId:       number;
  initialName?:  string;
  mode:          GameMode;   // ← new
  budget:        number;     // ← new
};

const MODE_BADGE_CLS: Record<GameMode, string> = {
  standard: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  pauper:   "bg-sky-500/15   text-sky-400   border-sky-500/25",
  royal:    "bg-purple-500/15 text-purple-400 border-purple-500/25",
};

export default function ClientDraftEditor({
  initialFen,
  initialPoints,
  draftId,
  initialName = "",
  mode,
  budget,
}: ClientDraftEditorProps) {
  const [position, setPosition]     = useState(initialFen);
  const [pointsUsed, setPointsUsed] = useState(initialPoints);
  const [draftName, setDraftName]   = useState(initialName);

  // budget prop replaces the old hardcoded 33
  const maxPoints = budget;

  const [activePiece, setActivePiece]       = useState<string | null>(null);
  const [draggedSquare, setDraggedSquare]   = useState<string | null>(null);
  const [legalSquares, setLegalSquares]     = useState<string[]>([]);
  const [illegalSquares, setIllegalSquares] = useState<string[]>([]);
  const [isDragging, setIsDragging]         = useState(false);
  const [saveState, setSaveState]           = useState<"idle" | "saving" | "saved" | "error">("idle");

  const pieceLibrary: LibraryPiece[] = useMemo(
    () => [
      { name: "Pawn",   value: 1, fen: "P", ui: "wP" },
      { name: "Knight", value: 3, fen: "N", ui: "wN" },
      { name: "Bishop", value: 3, fen: "B", ui: "wB" },
      { name: "Rook",   value: 5, fen: "R", ui: "wR" },
      { name: "Queen",  value: 9, fen: "Q", ui: "wQ" },
    ],
    []
  );

  // ─── FEN helpers (verbatim) ───────────────────────────────────────────────

  const expandFenRow = (row: string): string => {
    let result = "";
    for (const char of row) {
      if (/\d/.test(char)) result += "1".repeat(parseInt(char, 10));
      else result += char;
    }
    return result;
  };

  const compressFenRow = (row: string): string => {
    let result = ""; let count = 0;
    for (const char of row) {
      if (char === "1") { count++; }
      else { if (count > 0) { result += count; count = 0; } result += char; }
    }
    if (count > 0) result += count;
    return result;
  };

  const hasIllegalBattery = (pos?: string): boolean => {
    const currentPos = pos || position;
    const rows = currentPos.split(" ")[0].split("/");
    const board = rows.map(expandFenRow);
    for (let file = 0; file < 8; file++) {
      const p1 = board[7][file]; const p2 = board[6][file];
      if (p1 === "1" || p2 === "1") continue;
      if ((p1 === "Q" || p1 === "R") && (p2 === "Q" || p2 === "R")) return true;
    }
    for (let file = 0; file < 7; file++) {
      const pairs = [
        [board[7][file], board[6][file + 1]],
        [board[7][file + 1], board[6][file]],
      ];
      for (const [a, b] of pairs) {
        if (a === "1" || b === "1") continue;
        if ((a === "Q" || a === "B") && (b === "Q" || b === "B")) return true;
      }
    }
    return false;
  };

  const getPieceAt = (square: string): string => {
    const rank = parseInt(square[1], 10);
    const file = square.charCodeAt(0) - 97;
    const rankIndex = 8 - rank;
    const row = expandFenRow(position.split(" ")[0].split("/")[rankIndex]);
    return row[file];
  };

  const simulateMove = (from: string, to: string): string => {
    const fenParts = position.split(" ");
    const rows = fenParts[0].split("/");
    const fromRank = parseInt(from[1], 10); const fromFile = from.charCodeAt(0) - 97;
    const toRank   = parseInt(to[1],   10); const toFile   = to.charCodeAt(0)   - 97;
    const rankIndexFrom = 8 - fromRank; const rankIndexTo = 8 - toRank;
    let rowFrom = expandFenRow(rows[rankIndexFrom]);
    const piece = rowFrom[fromFile];
    rowFrom = rowFrom.substring(0, fromFile) + "1" + rowFrom.substring(fromFile + 1);
    rows[rankIndexFrom] = compressFenRow(rowFrom);
    let rowTo = expandFenRow(rows[rankIndexTo]);
    rowTo = rowTo.substring(0, toFile) + piece + rowTo.substring(toFile + 1);
    rows[rankIndexTo] = compressFenRow(rowTo);
    return rows.join("/") + " w - - 0 1";
  };

  const simulatePlacement = (fenLetter: string, targetSquare: string): string => {
    const rank = parseInt(targetSquare[1], 10);
    const fileIndex = targetSquare.charCodeAt(0) - 97;
    const fenParts = position.split(" ");
    const rows = fenParts[0].split("/");
    const rankIndex = 8 - rank;
    let row = expandFenRow(rows[rankIndex]);
    row = row.substring(0, fileIndex) + fenLetter + row.substring(fileIndex + 1);
    rows[rankIndex] = compressFenRow(row);
    return rows.join("/") + " w - - 0 1";
  };

  // ─── Square calculation (verbatim) ────────────────────────────────────────

  const calculateDragSquares = (from: string): { legal: string[]; illegal: string[] } => {
    const legal: string[] = []; const illegal: string[] = [];
    const piece = getPieceAt(from);
    if (!piece || piece === "1") return { legal, illegal };
    for (let r = 1; r <= 2; r++) {
      for (let f = 0; f < 8; f++) {
        const to = String.fromCharCode(97 + f) + r;
        if (to === from) continue;
        if (piece === "P" && r !== 2)                                         { illegal.push(to); continue; }
        if (piece === "K" && (r !== 1 || !["c","d","e","f"].includes(to[0]))){ illegal.push(to); continue; }
        if (getPieceAt(to) !== "1")                                           { illegal.push(to); continue; }
        const tempPos = simulateMove(from, to);
        if (hasIllegalBattery(tempPos)) illegal.push(to); else legal.push(to);
      }
    }
    return { legal, illegal };
  };

  const calculatePlacementSquares = (fenLetter: string): { legal: string[]; illegal: string[] } => {
    const legal: string[] = []; const illegal: string[] = [];
    for (let r = 1; r <= 2; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = String.fromCharCode(97 + f) + r;
        if (fenLetter === "P" && r !== 2)                                         { illegal.push(sq); continue; }
        if (fenLetter === "K" && (r !== 1 || !["c","d","e","f"].includes(sq[0]))){ illegal.push(sq); continue; }
        if (getPieceAt(sq) !== "1")                                               { illegal.push(sq); continue; }
        const tempPos = simulatePlacement(fenLetter, sq);
        if (hasIllegalBattery(tempPos)) illegal.push(sq); else legal.push(sq);
      }
    }
    return { legal, illegal };
  };

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (isDragging || activePiece) {
      legalSquares.forEach(sq  => { styles[sq] = { backgroundColor: "rgba(0,200,0,0.45)" }; });
      illegalSquares.forEach(sq => { styles[sq] = { backgroundColor: "rgba(220,0,0,0.35)" }; });
    }
    return styles;
  }, [isDragging, activePiece, legalSquares, illegalSquares]);

  // ─── Drag handlers (verbatim) ─────────────────────────────────────────────

  const handlePieceDrag = (args: any) => {
    const square = args.square as string;
    if (!isDragging) setIsDragging(true);
    if (draggedSquare !== square) {
      setDraggedSquare(square);
      const { legal, illegal } = calculateDragSquares(square);
      setLegalSquares(legal); setIllegalSquares(illegal);
    }
  };

  const handlePieceDrop = (args: any) => {
    const sourceSquare = args.sourceSquare as string;
    const targetSquare = args.targetSquare as string;
    setIsDragging(false); setDraggedSquare(null);
    setLegalSquares([]); setIllegalSquares([]);
    if (!targetSquare) return false;
    return movePiece(sourceSquare, targetSquare);
  };

  // ─── Piece operations (verbatim) ──────────────────────────────────────────

  const placePiece = (fenLetter: string, targetSquare: string, addPoints = true): boolean => {
    const rank = parseInt(targetSquare[1], 10);
    const fileIndex = targetSquare.charCodeAt(0) - 97;
    if (rank !== 1 && rank !== 2) { alert("Pieces can only be placed on ranks 1 or 2"); return false; }
    if (fenLetter === "P" && rank !== 2) { alert("Pawns can only be placed on rank 2"); return false; }
    if (fenLetter === "K") {
      if (rank !== 1) { alert("King can only be placed on rank 1"); return false; }
      if (!["c","d","e","f"].includes(targetSquare[0])) { alert("King must be placed on files c, d, e, or f on rank 1"); return false; }
    }
    const selected = pieceLibrary.find(p => p.fen === fenLetter) ||
      (fenLetter === "K" ? { name: "King", value: 0, fen: "K", ui: "wK" } : null);
    if (!selected) return false;
    if (addPoints && pointsUsed + selected.value > maxPoints) {
      alert(`Not enough points remaining (${pointsUsed}/${maxPoints})`); return false;
    }
    const fenParts = position.split(" ");
    const rows = fenParts[0].split("/");
    const rankIndex = 8 - rank;
    let row = expandFenRow(rows[rankIndex]);
    if (row[fileIndex] !== "1") { alert("Square is already occupied"); return false; }
    row = row.substring(0, fileIndex) + fenLetter + row.substring(fileIndex + 1);
    rows[rankIndex] = compressFenRow(row);
    const newPosition = rows.join("/") + " w - - 0 1";
    if (hasIllegalBattery(newPosition)) { alert("Illegal battery detected"); return false; }
    setPosition(newPosition);
    if (addPoints) setPointsUsed(prev => prev + selected.value);
    return true;
  };

  const removePiece = (square: string, refund = true): boolean => {
    const rank = parseInt(square[1], 10);
    const fileIndex = square.charCodeAt(0) - 97;
    const fenParts = position.split(" ");
    const rows = fenParts[0].split("/");
    const rankIndex = 8 - rank;
    let row = expandFenRow(rows[rankIndex]);
    const piece = row[fileIndex];
    if (piece === "1") return false;
    if (piece === "K") { alert("Cannot remove the king"); return false; }
    row = row.substring(0, fileIndex) + "1" + row.substring(fileIndex + 1);
    rows[rankIndex] = compressFenRow(row);
    const newPosition = rows.join("/") + " w - - 0 1";
    setPosition(newPosition);
    if (refund) {
      const selected = pieceLibrary.find(p => p.fen === piece.toUpperCase());
      if (selected) setPointsUsed(prev => Math.max(0, prev - selected.value));
    }
    return true;
  };

  const movePiece = (from: string, to: string): boolean => {
    const rankTo = parseInt(to[1], 10);
    if (rankTo !== 1 && rankTo !== 2) { alert("Pieces can only be moved to ranks 1 or 2"); return false; }
    const rankFrom = parseInt(from[1], 10); const fileFrom = from.charCodeAt(0) - 97;
    const fileTo   = to.charCodeAt(0) - 97;
    const fenParts = position.split(" ");
    const rows = fenParts[0].split("/");
    const rankIndexFrom = 8 - rankFrom; const rankIndexTo = 8 - rankTo;
    let rowFrom = expandFenRow(rows[rankIndexFrom]);
    const piece = rowFrom[fileFrom];
    if (piece === "1") return false;
    if (piece === "P" && rankTo !== 2) { alert("Pawns can only be on rank 2"); return false; }
    if (piece === "K") {
      if (rankTo !== 1 || !["e"].includes(to[0])) {
        alert("King can only be placed on rank 1, file e"); return false;
      }
    }
    rowFrom = rowFrom.substring(0, fileFrom) + "1" + rowFrom.substring(fileFrom + 1);
    rows[rankIndexFrom] = compressFenRow(rowFrom);
    let rowTo = expandFenRow(rows[rankIndexTo]);
    if (rowTo[fileTo] !== "1") { alert("Cannot move onto occupied square"); return false; }
    rowTo = rowTo.substring(0, fileTo) + piece + rowTo.substring(fileTo + 1);
    rows[rankIndexTo] = compressFenRow(rowTo);
    const newPosition = rows.join("/") + " w - - 0 1";
    if (hasIllegalBattery(newPosition)) { alert("Illegal battery detected"); return false; }
    setPosition(newPosition);
    return true;
  };

  // ─── Save — uses apiFetch so CSRF header is included automatically ─────────

  const handleSave = async () => {
    let finalName = draftName;
    if (!finalName.trim()) {
      const enteredName = prompt("Please enter a name for your draft:", "My New Army");
      if (!enteredName || !enteredName.trim()) {
        alert("Save cancelled – draft name is required.");
        return;
      }
      finalName = enteredName.trim();
      setDraftName(finalName);
    }
    setSaveState("saving");
    try {
      const res = await apiFetch(`/api/drafts/${draftId}`, {
        method: "POST",
        body:   JSON.stringify({ fen: position, points: pointsUsed, name: finalName }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      console.error("Save error:", err);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const remaining = maxPoints - pointsUsed;
  const pct       = Math.min(100, (pointsUsed / maxPoints) * 100);
  const modeCfg   = MODE_CONFIG[mode];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-[calc(100vh-56px)] bg-[#0f1117]">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 bg-[#1a1d2e] border-r border-white/8 flex flex-col p-5 gap-5">

        <Link
          href="/drafts"
          className="flex items-center gap-1.5 text-xs text-white/35 hover:text-white/70 transition-colors"
        >
          ← My Drafts
        </Link>

        {/* Mode badge */}
        <span className={`inline-flex items-center self-start px-2.5 py-1 rounded-lg text-[11px] font-bold border ${MODE_BADGE_CLS[mode]}`}>
          {modeCfg.label} · {modeCfg.draftBudget}pts
        </span>

        {/* Draft name */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-white/35 mb-1.5">
            Draft name
          </label>
          <input
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="Unnamed Draft"
            className="input text-sm"
          />
        </div>

        {/* Point budget */}
        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">Budget</span>
            <span className={`text-xl font-display font-700 tabular-nums ${
              remaining < 0 ? "text-red-400" : remaining === 0 ? "text-amber-400" : "text-white"
            }`}>
              {remaining}
              <span className="text-xs font-400 text-white/30 ml-1">left</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                remaining < 0 ? "bg-red-500" : remaining === 0 ? "bg-amber-400" : "bg-amber-400/70"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-white/30 mt-1.5">{pointsUsed} / {maxPoints} used</p>
        </div>

        {/* Piece selector */}
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-2">Place a piece</p>
          <div className="space-y-1.5">
            {pieceLibrary.map(p => {
              const canAfford = remaining >= p.value;
              const isActive  = activePiece === p.ui;
              return (
                <button
                  key={p.ui}
                  disabled={!canAfford && !isActive}
                  onClick={() => {
                    if (isActive) {
                      setActivePiece(null); setLegalSquares([]); setIllegalSquares([]);
                    } else {
                      setActivePiece(p.ui);
                      const { legal, illegal } = calculatePlacementSquares(p.fen);
                      setLegalSquares(legal); setIllegalSquares(illegal);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-all duration-150
                    ${isActive
                      ? "bg-amber-500/15 border-amber-500/50 text-amber-400"
                      : canAfford
                        ? "border-white/8 bg-white/[0.02] text-white/70 hover:bg-white/[0.06] hover:text-white hover:border-white/15 cursor-pointer"
                        : "border-white/5 bg-transparent text-white/20 cursor-not-allowed"
                    }`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className={`text-xs ${isActive ? "text-amber-400/70" : "text-white/30"}`}>
                    {p.value}pt{p.value !== 1 ? "s" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {activePiece && (
            <p className="text-[11px] text-amber-400/60 mt-2.5 text-center animate-pulse">
              Click a highlighted square to place
            </p>
          )}
        </div>

        {/* Instructions */}
        <div className="rounded-xl border border-white/6 bg-white/[0.015] p-3">
          <p className="text-[11px] text-white/30 leading-relaxed">
            <span className="text-white/45 font-semibold block mb-1">How to draft</span>
            Select a piece then click a green square.
            Drag pieces to reposition within ranks 1–2.
            Click an occupied square to remove it.
          </p>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saveState === "saving"}
          className="btn-primary w-full py-3"
        >
          {saveState === "saving" ? "Saving…"     :
           saveState === "saved"  ? "✓ Saved"     :
           saveState === "error"  ? "Save failed" :
           "Save Draft"}
        </button>

        {saveState === "error" && (
          <p className="text-xs text-red-400 text-center -mt-2">Please try again</p>
        )}
      </div>

      {/* ── Board ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <h1 className="font-display text-2xl font-700 text-white mb-6">
          {draftName || `Draft #${draftId}`}
        </h1>

        <div className="w-full max-w-[580px] rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60">
          <Chessboard
            options={{
              position,
              boardOrientation: "white",
              onPieceDrag:      handlePieceDrag,
              onPieceDrop:      handlePieceDrop,
              onSquareClick: ({ square }) => {
                if (activePiece) {
                  const selected = pieceLibrary.find(p => p.ui === activePiece);
                  if (!selected) return;
                  placePiece(selected.fen, square);
                  setActivePiece(null); setLegalSquares([]); setIllegalSquares([]);
                } else if (getPieceAt(square) !== "1") {
                  removePiece(square);
                }
              },
              onSquareRightClick: ({ square }) => removePiece(square),
              squareStyles: { ...customSquareStyles },
            }}
          />
        </div>

        <p className="mt-4 text-white/25 text-xs text-center max-w-md leading-relaxed">
          Pawns must stay on rank 2. King locked on e1. Batteries are illegal.
        </p>
        <p className="mt-2 text-white/25 text-xs text-center max-w-md leading-relaxed">
          Drag to reposition. Click occupied square or right-click to remove.
        </p>
      </div>
    </div>
  );
}
