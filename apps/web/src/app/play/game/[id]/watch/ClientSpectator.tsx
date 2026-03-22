"use client";
// apps/web/src/app/play/game/[id]/watch/ClientSpectator.tsx

import { useState, useEffect, useRef, useCallback } from "react";
import { Chessboard } from "react-chessboard";
import { getSocket }  from "@/app/lib/socket";
import Link           from "next/link";
import type { GameMode } from "@draftchess/shared/game-modes";

type Player = { id: number; username: string };
type GameStatus = "prep" | "active" | "finished";

type ClientSpectatorProps = {
  gameId:                  number;
  initialFen:              string;
  initialStatus:           string;
  mode:                    GameMode;
  player1:                 Player;
  player2:                 Player;
  whitePlayerId:           number;
  initialMoveNumber:       number;
  initialPlayer1Timebank:  number;
  initialPlayer2Timebank:  number;
};

const MOVE_TIME_LIMIT = 30_000;

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

function formatTime(ms: number): string {
  const total   = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function ClientSpectator({
  gameId,
  initialFen,
  initialStatus,
  mode,
  player1,
  player2,
  whitePlayerId,
  initialMoveNumber,
  initialPlayer1Timebank,
  initialPlayer2Timebank,
}: ClientSpectatorProps) {

  const [fen, setFen]             = useState(initialFen);
  const [status, setStatus]       = useState<GameStatus>(initialStatus as GameStatus);
  const [moveNumber, setMoveNumber] = useState(initialMoveNumber);
  const [player1Timebank, setPlayer1Timebank] = useState(initialPlayer1Timebank);
  const [player2Timebank, setPlayer2Timebank] = useState(initialPlayer2Timebank);
  const [lastMoveAt, setLastMoveAt] = useState<Date | null>(null);
  const [moveTimeRemaining, setMoveTimeRemaining] = useState(MOVE_TIME_LIMIT);
  const [prepTimeRemaining, setPrepTimeRemaining] = useState(60);
  const [prepStartedAt, setPrepStartedAt] = useState<Date | null>(null);
  const [winnerId, setWinnerId]   = useState<number | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  const timerSnapshotRef = useRef<{ lastMoveAt: Date; p1: number; p2: number } | null>(null);

  // White is always player1 or player2 — derive from whitePlayerId
  const whiteIsPlayer1 = whitePlayerId === player1.id;

  const handleUpdate = useCallback((payload: any) => {
    if (payload.fen !== undefined) setFen(payload.fen);
    if (payload.status !== undefined) setStatus(payload.status as GameStatus);
    if (payload.moveNumber !== undefined) setMoveNumber(payload.moveNumber);
    if (payload.winnerId !== undefined) setWinnerId(payload.winnerId ?? null);
    if (payload.endReason !== undefined) setEndReason(payload.endReason ?? null);
    if (payload.prepStartedAt) setPrepStartedAt(new Date(payload.prepStartedAt));

    if (payload.lastMoveAt !== undefined) {
      const d = new Date(payload.lastMoveAt);
      const p1 = payload.player1Timebank ?? player1Timebank;
      const p2 = payload.player2Timebank ?? player2Timebank;
      timerSnapshotRef.current = { lastMoveAt: d, p1, p2 };
      setLastMoveAt(d);
      setPlayer1Timebank(p1);
      setPlayer2Timebank(p2);
      setMoveTimeRemaining(MOVE_TIME_LIMIT);
    } else {
      if (payload.player1Timebank !== undefined) setPlayer1Timebank(payload.player1Timebank);
      if (payload.player2Timebank !== undefined) setPlayer2Timebank(payload.player2Timebank);
    }
  }, []); // eslint-disable-line

  // WebSocket setup
  useEffect(() => {
    let mounted = true;
    const handleUpdateRef = { current: handleUpdate };

    const init = async () => {
      try {
        // Load initial state from watch API
        const res = await fetch(`/api/game/${gameId}/watch`);
        if (res.ok) {
          const data = await res.json();
          if (mounted) handleUpdateRef.current(data);
        }

        const socket = await getSocket();
        if (!mounted) return;

        socket.emit("join-game", gameId);
        socket.on("game-update",  (p: any) => { if (mounted) handleUpdateRef.current(p); });
        socket.on("game-snapshot",(p: any) => { if (mounted) handleUpdateRef.current(p); });
        socket.on("connect_error", () => { if (mounted) setSocketError("Connection lost — reconnecting…"); });
        socket.on("reconnect",     () => { if (mounted) { setSocketError(null); socket.emit("join-game", gameId); } });
      } catch {
        if (mounted) setSocketError("Failed to connect.");
      }
    };

    init();
    return () => {
      mounted = false;
      getSocket().then(s => {
        s.off("game-update");
        s.off("game-snapshot");
        s.off("connect_error");
        s.off("reconnect");
      }).catch(() => {});
    };
  }, [gameId]); // eslint-disable-line

  // Prep countdown
  useEffect(() => {
    if (status !== "prep" || !prepStartedAt) return;
    const t = setInterval(() => {
      setPrepTimeRemaining(Math.max(0, 60 - (Date.now() - prepStartedAt.getTime()) / 1000));
    }, 200);
    return () => clearInterval(t);
  }, [status, prepStartedAt]);

  // Move timer (display only)
  useEffect(() => {
    if (status !== "active") return;
    const tick = () => {
      const snap = timerSnapshotRef.current;
      if (!snap) return;
      const elapsed    = Date.now() - snap.lastMoveAt.getTime();
      const fenTurn    = fen.split(" ")[1] ?? "w";
      const activeIsP1 = fenTurn === "w" ? whiteIsPlayer1 : !whiteIsPlayer1;
      setMoveTimeRemaining(Math.max(0, MOVE_TIME_LIMIT - elapsed));
      if (elapsed > MOVE_TIME_LIMIT) {
        const overage = elapsed - MOVE_TIME_LIMIT;
        if (activeIsP1) setPlayer1Timebank(Math.max(0, snap.p1 - overage));
        else            setPlayer2Timebank(Math.max(0, snap.p2 - overage));
      }
    };
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [status, fen, whiteIsPlayer1]);

  const fenTurn    = fen.split(" ")[1] ?? "w";
  const activeIsP1 = fenTurn === "w" ? whiteIsPlayer1 : !whiteIsPlayer1;

  // Which player is "top" on the board (always show white at bottom by convention for spectators)
  const topPlayer    = whiteIsPlayer1 ? player2 : player1;
  const bottomPlayer = whiteIsPlayer1 ? player1 : player2;
  const topTimebank    = whiteIsPlayer1 ? player2Timebank : player1Timebank;
  const bottomTimebank = whiteIsPlayer1 ? player1Timebank : player2Timebank;
  const topIsActive    = whiteIsPlayer1 ? !activeIsP1 : activeIsP1;
  const bottomIsActive = whiteIsPlayer1 ? activeIsP1  : !activeIsP1;

  const winner = winnerId === player1.id ? player1 : winnerId === player2.id ? player2 : null;

  return (
    <>
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        .slide-in  { animation: slideIn 0.3s ease both; }
        .live-dot  { animation: pulse 1.5s ease-in-out infinite; }
      `}</style>

      <div className="min-h-[calc(100vh-56px)] bg-[#0f1117] flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[1000px] flex flex-col lg:flex-row gap-6 items-center lg:items-start">

          {/* ── Board column ─────────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-3 flex-1 min-w-0 w-full max-w-[600px]">

            {/* Top player row */}
            <div className="w-full flex items-center justify-between gap-3 px-1 slide-in">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-lg">
                  {whiteIsPlayer1 ? "♚" : "♔"}
                </div>
                <div>
                  <Link href={`/profile/${topPlayer.username}`} className="text-sm font-display font-600 text-white/80 hover:text-white transition-colors leading-none">
                    {topPlayer.username}
                  </Link>
                  <p className="text-[10px] text-white/30 mt-0.5">{whiteIsPlayer1 ? "Black" : "White"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">Bank</span>
                <span className={`font-display font-700 text-base tabular-nums ${topIsActive && status === "active" ? "text-amber-400" : "text-white/50"}`}>
                  {formatTime(topTimebank)}
                </span>
              </div>
            </div>

            {/* Board */}
            <div className="relative w-full rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.7)] slide-in">
              <Chessboard
                options={{
                  position:         fen,
                  boardOrientation: "white",
                  onPieceDrop:      () => false,
                  onPieceDrag:      () => false,
                }}
              />

            {/* Prep status — no overlay, board stays fully visible.
                FEN masking is applied server-side: spectators see the base
                draft FEN only, aux placements are never sent to this client. */}
            {status === "prep" && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <div className="px-3 py-1.5 rounded-full bg-black/70 border border-white/10 backdrop-blur-sm flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                  <span className="text-xs text-white/60 whitespace-nowrap">Players are placing pieces · {Math.ceil(prepTimeRemaining)}s</span>
                </div>
              </div>
            )}
            </div>

            {/* Bottom player row */}
            <div className="w-full flex items-center justify-between gap-3 px-1 slide-in">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-lg">
                  {whiteIsPlayer1 ? "♔" : "♚"}
                </div>
                <div>
                  <Link href={`/profile/${bottomPlayer.username}`} className="text-sm font-display font-600 text-white hover:text-amber-400 transition-colors leading-none">
                    {bottomPlayer.username}
                  </Link>
                  <p className="text-[10px] text-white/30 mt-0.5">{whiteIsPlayer1 ? "White" : "Black"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">Bank</span>
                <span className={`font-display font-700 text-base tabular-nums ${bottomIsActive && status === "active" ? "text-amber-400" : "text-white/50"}`}>
                  {formatTime(bottomTimebank)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Right sidebar ─────────────────────────────────────────────── */}
          <aside className="flex flex-col gap-4 w-full lg:w-56 flex-shrink-0 slide-in">

            {/* Status card */}
            <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] p-5">
              <div className="flex items-center gap-2 mb-4">
                {status !== "finished" ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-red-500 live-dot" />
                    <span className="text-xs font-bold uppercase tracking-widest text-red-400">Live</span>
                  </>
                ) : (
                  <span className="text-xs font-bold uppercase tracking-widest text-white/30">Finished</span>
                )}
              </div>

              {status === "active" && (
                <>
                  <div className={`font-display text-5xl font-800 tabular-nums leading-none mb-3 ${
                    moveTimeRemaining < 8000 ? "text-red-400" : moveTimeRemaining < 15000 ? "text-orange-400" : "text-amber-400"
                  }`}>
                    {formatTime(moveTimeRemaining)}
                  </div>
                  <div className="h-1 rounded-full bg-white/6 overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all duration-100 ${
                        moveTimeRemaining < 8000 ? "bg-red-500" : moveTimeRemaining < 15000 ? "bg-orange-400" : "bg-amber-400"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, (moveTimeRemaining / MOVE_TIME_LIMIT) * 100))}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-white/25">
                    {activeIsP1 ? player1.username : player2.username}'s move
                  </p>
                </>
              )}

              {status === "finished" && (
                <div className="mt-1">
                  {winner ? (
                    <p className="text-white/70 text-sm">
                      <span className="font-semibold text-white">{winner.username}</span> wins
                    </p>
                  ) : (
                    <p className="text-white/70 text-sm">Draw</p>
                  )}
                  {endReason && (
                    <p className="text-white/35 text-xs mt-1">{END_REASON_LABEL[endReason] ?? endReason}</p>
                  )}
                </div>
              )}
            </div>

            {/* Game info */}
            <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-3">Game</p>
              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-white/35">ID</span>
                  <span className="font-display font-600 text-white/70">#{gameId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/35">Mode</span>
                  <span className="font-display font-600 text-white/70">{MODE_LABEL[mode] ?? mode}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/35">Moves</span>
                  <span className="font-display font-600 text-white/70 tabular-nums">{moveNumber}</span>
                </div>
              </div>
            </div>

            {/* Socket warning */}
            {socketError && (
              <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs text-center">
                ⚠ {socketError}
                <button onClick={() => window.location.reload()} className="block w-full mt-1 underline opacity-70 hover:opacity-100">Refresh</button>
              </div>
            )}

            {/* Spectator notice */}
            <div className="px-4 py-3 rounded-xl border border-white/6 bg-white/[0.015]">
              <p className="text-[11px] text-white/30 leading-relaxed text-center">
                You are watching as a spectator
              </p>
            </div>

            {/* Link to replay once finished */}
            {status === "finished" && (
              <Link
                href={`/play/game/${gameId}/replay`}
                className="w-full py-3 rounded-xl border border-amber-500/25 bg-amber-500/8 text-amber-400 font-display font-600 text-sm text-center hover:bg-amber-500/15 transition-colors"
              >
                View Replay
              </Link>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
