"use client";
// apps/web/src/app/play/game/[id]/replay/ClientReplay.tsx

import { useState, useCallback, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import Link           from "next/link";
import type { GameMode } from "@draftchess/shared/game-modes";

type Player = { id: number; username: string };
type Move   = { moveNumber: number; from: string; to: string; san: string; fen: string; promotion: string | null };

type ClientReplayProps = {
  gameId:           number;
  mode:             string;
  player1:          Player;
  player2:          Player;
  whitePlayerId:    number;
  winnerId:         number | null;
  endReason:        string | null;
  player1EloBefore: number | null;
  player2EloBefore: number | null;
  player1EloAfter:  number | null;
  player2EloAfter:  number | null;
  moves:            Move[];
  pgn:              string;
  finalFen:         string;
};

const MODE_LABEL: Record<string, string> = {
  standard: "Standard",
  pauper:   "Pauper",
  royal:    "Royal",
};

const END_REASON_LABEL: Record<string, string> = {
  checkmate:             "Checkmate",
  stalemate:             "Stalemate",
  repetition:            "Threefold Repetition",
  insufficient_material: "Insufficient Material",
  draw_agreement:        "Draw by Agreement",
  timeout:               "Time Out",
  resignation:           "Resignation",
  abandoned:             "Abandoned",
};

// Starting position FEN for Draft Chess (kings only, no other pieces set up yet)
// The first move's FEN is the position after move 1 — index 0.
// To show the initial position we keep a synthetic starting FEN.
const INITIAL_FEN = "8/8/8/8/8/8/8/4K3 w - - 0 1";

export default function ClientReplay({
  gameId, mode, player1, player2, whitePlayerId,
  winnerId, endReason,
  player1EloBefore, player2EloBefore, player1EloAfter, player2EloAfter,
  moves, pgn, finalFen,
}: ClientReplayProps) {

  // -1 = starting position, 0..moves.length-1 = after each move
  const [cursor, setCursor] = useState(-1);

  const currentFen = cursor === -1
    ? (moves[0] ? INITIAL_FEN : finalFen)
    : (moves[cursor]?.fen ?? finalFen);

  const white = whitePlayerId === player1.id ? player1 : player2;
  const black = whitePlayerId === player1.id ? player2 : player1;

  const whiteEloBefore = whitePlayerId === player1.id ? player1EloBefore : player2EloBefore;
  const blackEloBefore = whitePlayerId === player1.id ? player2EloBefore : player1EloBefore;
  const whiteEloAfter  = whitePlayerId === player1.id ? player1EloAfter  : player2EloAfter;
  const blackEloAfter  = whitePlayerId === player1.id ? player2EloAfter  : player1EloAfter;

  const winner = winnerId === player1.id ? player1 : winnerId === player2.id ? player2 : null;

  const goTo    = useCallback((i: number) => setCursor(Math.max(-1, Math.min(moves.length - 1, i))), [moves.length]);
  const goStart = () => setCursor(-1);
  const goEnd   = () => setCursor(moves.length - 1);
  const goPrev  = () => goTo(cursor - 1);
  const goNext  = () => goTo(cursor + 1);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "Home")       goStart();
      if (e.key === "End")        goEnd();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cursor]); // eslint-disable-line

  // PGN download
  const downloadPgn = () => {
    const blob = new Blob([pgn], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `draftchess-game-${gameId}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Highlight the last move squares
  const highlightSquares: Record<string, React.CSSProperties> = {};
  if (cursor >= 0 && moves[cursor]) {
    const m = moves[cursor]!;
    highlightSquares[m.from] = { backgroundColor: "rgba(245, 158, 11, 0.25)" };
    highlightSquares[m.to]   = { backgroundColor: "rgba(245, 158, 11, 0.35)" };
  }

  // Group moves into pairs for the move list
  const movePairs: { num: number; white?: Move; black?: Move }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    movePairs.push({
      num:   Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <>
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .slide-in { animation: slideIn 0.3s ease both; }
        .move-btn { transition: all 0.1s; }
        .move-btn:hover { background: rgba(255,255,255,0.06); }
        .move-btn.active { background: rgba(245,158,11,0.15); color: #f59e0b; }
      `}</style>

      <div className="min-h-[calc(100vh-56px)] bg-[#0f1117] px-4 py-6">
        <div className="max-w-[1100px] mx-auto flex flex-col lg:flex-row gap-6 items-start">

          {/* ── Board + controls ─────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-3 flex-1 min-w-0 w-full max-w-[600px]">

            {/* Black player row */}
            <div className="w-full flex items-center justify-between gap-3 px-1 slide-in">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-lg">♚</div>
                <div>
                  <Link href={`/profile/${black.username}`} className="text-sm font-display font-600 text-white/80 hover:text-white transition-colors leading-none">
                    {black.username}
                  </Link>
                  {blackEloBefore !== null && (
                    <p className="text-[10px] text-white/30 mt-0.5">{blackEloBefore} ELO</p>
                  )}
                </div>
              </div>
              {blackEloAfter !== null && blackEloBefore !== null && (
                <span className={`text-sm font-display font-700 px-2 py-0.5 rounded-full ${
                  blackEloAfter > blackEloBefore ? "bg-emerald-500/15 text-emerald-400" :
                  blackEloAfter < blackEloBefore ? "bg-red-500/10 text-red-400" : "bg-white/8 text-white/40"
                }`}>
                  {blackEloAfter > blackEloBefore ? "+" : ""}{blackEloAfter - blackEloBefore}
                </span>
              )}
            </div>

            {/* Board */}
            <div className="w-full rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.7)] slide-in">
              <Chessboard
                options={{
                  position:         currentFen,
                  boardOrientation: "white",
                  onPieceDrop:      () => false,
                  onPieceDrag:      () => false,
                  squareStyles:     highlightSquares,
                }}
              />
            </div>

            {/* White player row */}
            <div className="w-full flex items-center justify-between gap-3 px-1 slide-in">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-lg">♔</div>
                <div>
                  <Link href={`/profile/${white.username}`} className="text-sm font-display font-600 text-white hover:text-amber-400 transition-colors leading-none">
                    {white.username}
                  </Link>
                  {whiteEloBefore !== null && (
                    <p className="text-[10px] text-white/30 mt-0.5">{whiteEloBefore} ELO</p>
                  )}
                </div>
              </div>
              {whiteEloAfter !== null && whiteEloBefore !== null && (
                <span className={`text-sm font-display font-700 px-2 py-0.5 rounded-full ${
                  whiteEloAfter > whiteEloBefore ? "bg-emerald-500/15 text-emerald-400" :
                  whiteEloAfter < whiteEloBefore ? "bg-red-500/10 text-red-400" : "bg-white/8 text-white/40"
                }`}>
                  {whiteEloAfter > whiteEloBefore ? "+" : ""}{whiteEloAfter - whiteEloBefore}
                </span>
              )}
            </div>

            {/* Nav controls */}
            <div className="flex items-center gap-2 slide-in">
              {[
                { label: "⟨⟨", action: goStart, title: "Start (Home)" },
                { label: "⟨",  action: goPrev,  title: "Previous (←)" },
                { label: "⟩",  action: goNext,  title: "Next (→)" },
                { label: "⟩⟩", action: goEnd,   title: "End (End)" },
              ].map(({ label, action, title }) => (
                <button
                  key={label}
                  onClick={action}
                  title={title}
                  className="w-10 h-10 rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/15 text-white/60 hover:text-white font-display font-600 text-sm transition-all"
                >
                  {label}
                </button>
              ))}
              <span className="text-xs text-white/30 tabular-nums ml-2">
                {cursor === -1 ? "Start" : `Move ${cursor + 1} / ${moves.length}`}
              </span>
            </div>
          </div>

          {/* ── Right panel ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 w-full lg:w-64 flex-shrink-0 slide-in">

            {/* Result card */}
            <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-3">Result</p>
              <p className="text-lg font-display font-700 text-white mb-0.5">
                {winner ? `${winner.username} wins` : "Draw"}
              </p>
              {endReason && (
                <p className="text-xs text-white/40">{END_REASON_LABEL[endReason] ?? endReason}</p>
              )}
              <div className="mt-3 pt-3 border-t border-white/6 flex justify-between text-xs text-white/35">
                <span>{MODE_LABEL[mode] ?? mode}</span>
                <span>{moves.length} moves</span>
                <span>#{gameId}</span>
              </div>
            </div>

            {/* Move list */}
            <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/6 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">Moves</p>
                <div className="flex gap-2 text-[10px] text-white/25 font-bold uppercase tracking-wider">
                  <span className="w-16 text-center">White</span>
                  <span className="w-16 text-center">Black</span>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {movePairs.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-white/25 text-center">No moves recorded</p>
                ) : (
                  movePairs.map(({ num, white: wm, black: bm }) => {
                    const wIdx = wm ? wm.moveNumber - 1 : -1;
                    const bIdx = bm ? bm.moveNumber - 1 : -1;
                    return (
                      <div key={num} className="flex items-center border-b border-white/4 last:border-0">
                        <span className="w-8 px-2 py-2 text-[10px] text-white/20 tabular-nums flex-shrink-0">{num}.</span>
                        <button
                          onClick={() => wm && goTo(wIdx)}
                          className={`flex-1 py-2 text-sm text-center move-btn rounded-none ${cursor === wIdx ? "active" : "text-white/60"}`}
                        >
                          {wm?.san ?? ""}
                        </button>
                        <button
                          onClick={() => bm && goTo(bIdx)}
                          className={`flex-1 py-2 text-sm text-center move-btn rounded-none ${cursor === bIdx ? "active" : "text-white/50"}`}
                        >
                          {bm?.san ?? ""}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* PGN download */}
            <button
              onClick={downloadPgn}
              className="w-full py-3 rounded-xl border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.05] text-white/50 hover:text-white/80 font-display font-600 text-sm transition-all"
            >
              Download PGN
            </button>

            {/* Watch live link if needed */}
            <Link
              href={`/`}
              className="text-xs text-white/25 hover:text-white/45 text-center transition-colors"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
