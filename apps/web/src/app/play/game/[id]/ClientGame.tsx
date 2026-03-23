// apps/web/src/app/play/game/[id]/ClientGame.tsx
//
// CHANGE: Rematch source game ID is now reliably resolved.
//
// Previously rematchSourceGameId was initialised to the current page's gameId
// and only updated when a live rematch-offered socket event arrived. If the
// page loaded with a pre-existing offer (e.g. after a browser refresh) the
// source game ID stayed as the current gameId, which could be wrong when the
// offer lives on a different (older) finished game.
//
// Fix: the /api/game/[id]/status endpoint now returns rematchOfferedBy and
// rematchSourceGameId in its response. We read those on initial load and seed
// rematchSourceGameId from there. The live socket event still updates it for
// the in-session case. The accept route's slow-path scan is still in place as
// a final safety net.

"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { getSocket } from "@/app/lib/socket";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/app/lib/api-fetch";
import { modeAuxPoints, type GameMode } from "@draftchess/shared/game-modes";

class DraftChess extends Chess {
  constructor(fen?: string) { super(fen ?? "start"); }
  move(moveObj: any, options?: any) {
    const result = super.move(moveObj, options);
    if (result && (result.flags.includes("k") || result.flags.includes("q") || result.flags.includes("e"))) {
      super.undo();
      throw new Error("Castling and en passant are not allowed");
    }
    return result;
  }
}

type GameStatus = "prep" | "active" | "finished";
type PendingPromotion = { from: Square; to: Square };
type GameResult = {
  winnerId: number | null;
  endReason: string;
  player1EloAfter?: number;
  player2EloAfter?: number;
  eloChange?: number;
};

type ClientGameProps = {
  gameId: number;
  myUserId: number;
  initialFen: string;
  isWhite: boolean;
  initialStatus: string;
  initialPrepStartedAt: Date | null;
  initialReadyPlayer1: boolean;
  initialReadyPlayer2: boolean;
  initialAuxPointsPlayer1: number;
  initialAuxPointsPlayer2: number;
  player1Id: number;
  player2Id: number;
  mode: GameMode;
};

const MOVE_TIME_LIMIT         = 30000;
const TIMEBANK_BONUS_INTERVAL = 20;
const REMATCH_EXPIRY_MS       = 30000;

function getTimerClass(ms: number, isActive: boolean) {
  if (!isActive) return "text-white/30";
  if (ms <= 0)    return "text-red-400";
  if (ms < 8000)  return "text-red-400 animate-pulse";
  if (ms < 15000) return "text-orange-400";
  return "text-amber-400";
}

function getTimerBarWidth(ms: number): number {
  return Math.max(0, Math.min(100, (ms / MOVE_TIME_LIMIT) * 100));
}

function getTimerBarClass(ms: number): string {
  if (ms <= 0 || ms < 8000)  return "bg-red-500";
  if (ms < 15000)             return "bg-orange-400";
  return "bg-amber-400";
}

export default function ClientGame({
  gameId, myUserId, initialFen, isWhite, initialStatus,
  initialPrepStartedAt, initialReadyPlayer1, initialReadyPlayer2,
  initialAuxPointsPlayer1, initialAuxPointsPlayer2, player1Id, player2Id, mode,
}: ClientGameProps) {
  const toast = useToast();

  const [fen, setFen]                             = useState(initialFen);
  const [status, setStatus]                       = useState<GameStatus>(initialStatus as GameStatus);
  const [prepStartedAt, setPrepStartedAt]         = useState<Date | null>(initialPrepStartedAt);
  const [readyPlayer1, setReadyPlayer1]           = useState(initialReadyPlayer1);
  const [readyPlayer2, setReadyPlayer2]           = useState(initialReadyPlayer2);
  const [auxPointsPlayer1, setAuxPointsPlayer1]   = useState(initialAuxPointsPlayer1);
  const [auxPointsPlayer2, setAuxPointsPlayer2]   = useState(initialAuxPointsPlayer2);
  const [player1Timebank, setPlayer1Timebank]     = useState(60000);
  const [player2Timebank, setPlayer2Timebank]     = useState(60000);
  const [lastMoveAt, setLastMoveAt]               = useState<Date | null>(null);
  const [moveTimeRemaining, setMoveTimeRemaining] = useState(MOVE_TIME_LIMIT);
  const [prepTimeRemaining, setPrepTimeRemaining] = useState(60);
  const [moveNumber, setMoveNumber]               = useState(0);
  const [showTimebankBonus, setShowTimebankBonus] = useState(false);
  const [gameResult, setGameResult]               = useState<GameResult | null>(null);
  const [socketError, setSocketError]             = useState<string | null>(null);
  const [activePiece, setActivePiece]             = useState<string | null>(null);
  const [legalSquares, setLegalSquares]           = useState<string[]>([]);
  const [illegalSquares, setIllegalSquares]       = useState<string[]>([]);
  const [pendingPromotion, setPendingPromotion]   = useState<PendingPromotion | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(true);

  // ── Draw state ──────────────────────────────────────────────────────────────
  const [drawOfferedBy, setDrawOfferedBy]               = useState(0);
  const [drawDeclinedMoveNumber, setDrawDeclinedMoveNumber] = useState(0);
  const [drawSubmitting, setDrawSubmitting]             = useState(false);

  // ── Rematch state ───────────────────────────────────────────────────────────
  const [rematchOfferedBy, setRematchOfferedBy]         = useState(0);
  const [rematchOfferedAt, setRematchOfferedAt]         = useState(0);
  const [rematchExpired, setRematchExpired]             = useState(false);
  const [rematchSubmitting, setRematchSubmitting]       = useState(false);
  const [rematchCountdown, setRematchCountdown]         = useState(REMATCH_EXPIRY_MS);

  // FIX: rematchSourceGameId is seeded from the status API response on load,
  // not just from the current gameId. This ensures that after a page refresh
  // we still POST accept/decline to the game that holds the offer, even if
  // that's a different (older) finished game than the current URL param.
  const [rematchSourceGameId, setRematchSourceGameId] = useState(gameId);

  const chessRef         = useRef<DraftChess>(new DraftChess(initialFen));
  const isSubmittingMove = useRef(false);
  const timerSnapshot    = useRef<{
    lastMoveAt: Date;
    player1Timebank: number;
    player2Timebank: number;
  } | null>(null);

  const player1TimebankRef = useRef(60000);
  const player2TimebankRef = useRef(60000);
  useEffect(() => { player1TimebankRef.current = player1Timebank; }, [player1Timebank]);
  useEffect(() => { player2TimebankRef.current = player2Timebank; }, [player2Timebank]);

  const isPlayer1    = myUserId === player1Id;
  const ownReady     = isPlayer1 ? readyPlayer1 : readyPlayer2;
  const oppReady     = isPlayer1 ? readyPlayer2 : readyPlayer1;
  const auxPoints    = isPlayer1 ? auxPointsPlayer1 : auxPointsPlayer2;
  const myTimebank   = isPlayer1 ? player1Timebank : player2Timebank;
  const oppTimebank  = isPlayer1 ? player2Timebank : player1Timebank;
  const auxPointsMax = modeAuxPoints(mode);

  const isMyTurn = useMemo(() => {
    if (status !== "active") return false;
    try {
      const turn = fen.split(" ")[1];
      return (turn === "w" && isWhite) || (turn === "b" && !isWhite);
    } catch { return false; }
  }, [fen, status, isWhite]);

  // ── Draw cooldown ───────────────────────────────────────────────────────────
  const drawCooldownRemaining = useMemo(() => {
    if (drawDeclinedMoveNumber === 0) return 0;
    return Math.max(0, 3 - (moveNumber - drawDeclinedMoveNumber));
  }, [drawDeclinedMoveNumber, moveNumber]);

  const canOfferDraw        = status === "active" && drawOfferedBy === 0 && drawCooldownRemaining === 0;
  const iHaveOfferedDraw    = drawOfferedBy === myUserId;
  const opponentOfferedDraw = drawOfferedBy !== 0 && drawOfferedBy !== myUserId;

  // ── Rematch countdown ───────────────────────────────────────────────────────
  const iHaveOfferedRematch    = rematchOfferedBy === myUserId;
  const opponentOfferedRematch = rematchOfferedBy !== 0 && rematchOfferedBy !== myUserId;

  useEffect(() => {
    if (!iHaveOfferedRematch || rematchOfferedAt === 0) return;
    const tick = () => {
      const remaining = REMATCH_EXPIRY_MS - (Date.now() - rematchOfferedAt);
      if (remaining <= 0) {
        setRematchCountdown(0);
        setRematchExpired(true);
        setRematchOfferedBy(0);
      } else {
        setRematchCountdown(remaining);
      }
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [iHaveOfferedRematch, rematchOfferedAt]);

  const pieceLibrary = useMemo(() => [
    { name: "Pawn",   value: 1, fen: "P", ui: isWhite ? "wP" : "bP", symbol: isWhite ? "♙" : "♟" },
    { name: "Knight", value: 3, fen: "N", ui: isWhite ? "wN" : "bN", symbol: isWhite ? "♘" : "♞" },
    { name: "Bishop", value: 3, fen: "B", ui: isWhite ? "wB" : "bB", symbol: isWhite ? "♗" : "♝" },
    { name: "Rook",   value: 5, fen: "R", ui: isWhite ? "wR" : "bR", symbol: isWhite ? "♖" : "♜" },
  ], [isWhite]);

  const promotionPieces = useMemo(() => [
    { piece: "q", symbol: isWhite ? "♛" : "♕", name: "Queen" },
    { piece: "r", symbol: isWhite ? "♜" : "♖", name: "Rook" },
    { piece: "b", symbol: isWhite ? "♝" : "♗", name: "Bishop" },
    { piece: "n", symbol: isWhite ? "♞" : "♘", name: "Knight" },
  ], [isWhite]);

  const formatTime = (ms: number): string => {
    const total   = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const updateTimerSnapshot = useCallback((
    newLastMoveAt: Date,
    newP1Timebank: number,
    newP2Timebank: number,
  ) => {
    timerSnapshot.current = { lastMoveAt: newLastMoveAt, player1Timebank: newP1Timebank, player2Timebank: newP2Timebank };
    player1TimebankRef.current = newP1Timebank;
    player2TimebankRef.current = newP2Timebank;
    setLastMoveAt(newLastMoveAt);
    setPlayer1Timebank(newP1Timebank);
    setPlayer2Timebank(newP2Timebank);
    setMoveTimeRemaining(MOVE_TIME_LIMIT);
  }, []);

  const handleGameUpdate = useCallback((payload: any) => {
    if (payload.fen !== undefined) {
      setFen(payload.fen);
      try { chessRef.current = new DraftChess(payload.fen); } catch { /* keep current */ }
    }

    if (payload.status       !== undefined) setStatus(payload.status as GameStatus);
    if (payload.readyPlayer1 !== undefined) setReadyPlayer1(payload.readyPlayer1);
    if (payload.readyPlayer2 !== undefined) setReadyPlayer2(payload.readyPlayer2);
    if (payload.auxPointsPlayer1 !== undefined) setAuxPointsPlayer1(payload.auxPointsPlayer1);
    if (payload.auxPointsPlayer2 !== undefined) setAuxPointsPlayer2(payload.auxPointsPlayer2);

    if (payload.moveNumber !== undefined) {
      setMoveNumber((prev) => {
        const next = payload.moveNumber;
        if (next > 0 && next % TIMEBANK_BONUS_INTERVAL === 0 && next !== prev) {
          setShowTimebankBonus(true);
          setTimeout(() => setShowTimebankBonus(false), 4000);
        }
        return next;
      });
    }

    if (payload.lastMoveAt !== undefined) {
      updateTimerSnapshot(
        new Date(payload.lastMoveAt),
        payload.player1Timebank ?? player1TimebankRef.current,
        payload.player2Timebank ?? player2TimebankRef.current,
      );
    } else {
      if (payload.player1Timebank !== undefined) {
        setPlayer1Timebank(payload.player1Timebank);
        player1TimebankRef.current = payload.player1Timebank;
      }
      if (payload.player2Timebank !== undefined) {
        setPlayer2Timebank(payload.player2Timebank);
        player2TimebankRef.current = payload.player2Timebank;
      }
    }

    if (payload.status === "finished") {
      setGameResult({
        winnerId:        payload.winnerId  ?? null,
        endReason:       payload.endReason ?? "unknown",
        player1EloAfter: payload.player1EloAfter,
        player2EloAfter: payload.player2EloAfter,
        eloChange:       payload.eloChange,
      });
      setDrawOfferedBy(0);
    }

    // Draw events
    if (payload.drawOfferedBy !== undefined) {
      setDrawOfferedBy(payload.drawOfferedBy);
      if (payload.drawOfferedBy !== 0 && payload.drawOfferedBy !== myUserId) {
        toast.info("Opponent offers a draw");
      }
    }
    if (payload.drawDeclined) {
      setDrawOfferedBy(0);
      setDrawDeclinedMoveNumber(moveNumber);
      if (iHaveOfferedDraw) toast.warn("Draw offer declined");
    }

    // Rematch events
    if (payload.rematchOfferedBy !== undefined && payload.rematchOfferedBy !== 0) {
      setRematchOfferedBy(payload.rematchOfferedBy);
      setRematchOfferedAt(Date.now());
      setRematchExpired(false);
      // FIX: source game comes from the event payload when available;
      // falls back to current gameId for in-session offers.
      setRematchSourceGameId(payload.rematchSourceGameId ?? gameId);
      if (payload.rematchOfferedBy !== myUserId) toast.info("Opponent wants a rematch");
    }
    if (payload.rematchDeclined) {
      if (rematchOfferedBy === myUserId) toast.warn("Rematch declined");
      setRematchOfferedBy(0);
      setRematchExpired(false);
    }
    if (payload.rematchCancelled) {
      setRematchOfferedBy(0);
      setRematchExpired(false);
    }
  }, [updateTimerSnapshot, myUserId, moveNumber, iHaveOfferedDraw, toast, gameId, rematchOfferedBy]);

  const handleGameUpdateRef    = useRef(handleGameUpdate);
  const updateTimerSnapshotRef = useRef(updateTimerSnapshot);
  useEffect(() => { handleGameUpdateRef.current    = handleGameUpdate;  }, [handleGameUpdate]);
  useEffect(() => { updateTimerSnapshotRef.current = updateTimerSnapshot; }, [updateTimerSnapshot]);

  // ─── WebSocket setup ───────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const res = await apiFetch(`/api/game/${gameId}/status`, { method: "GET" });
        if (!res.ok) throw new Error("Failed to load game state");
        const data = await res.json();
        if (!mounted) return;

        handleGameUpdateRef.current(data);

        if (data.prepStartedAt) setPrepStartedAt(new Date(data.prepStartedAt));
        if (data.moveNumber !== undefined) setMoveNumber(data.moveNumber);
        if (data.lastMoveAt) {
          updateTimerSnapshotRef.current(new Date(data.lastMoveAt), data.player1Timebank ?? 60000, data.player2Timebank ?? 60000);
          if (data.timeRemainingOnMove !== undefined) setMoveTimeRemaining(data.timeRemainingOnMove);
        }
        if (data.status === "finished" && data.endReason) {
          setGameResult({ winnerId: data.winnerId ?? null, endReason: data.endReason, player1EloAfter: data.player1EloAfter, player2EloAfter: data.player2EloAfter, eloChange: data.eloChange });
        }

        // FIX: Seed rematch state from the initial status load.
        // If the game is finished and someone already offered a rematch before
        // this page load (e.g. after a browser refresh), we need to know:
        //   1. Who offered (rematchOfferedBy)
        //   2. Which game the offer is stored on (rematchSourceGameId)
        // The status API returns these fields for finished games.
        if (data.rematchOfferedBy && data.rematchOfferedBy !== 0) {
          setRematchOfferedBy(data.rematchOfferedBy);
          setRematchOfferedAt(data.rematchOfferedAt ?? Date.now());
          setRematchExpired(false);
          setRematchSourceGameId(data.rematchSourceGameId ?? gameId);
        }

        const socket = await getSocket();
        if (!mounted) return;

        socket.emit("join-game", gameId);

        socket.on("game-update",           (p: any)   => { if (mounted) handleGameUpdateRef.current(p); });
        socket.on("opponent-disconnected", () => { if (mounted) { setOpponentConnected(false); toast.warn("Opponent disconnected"); } });
        socket.on("opponent-connected",    () => { if (mounted) { setOpponentConnected(true);  toast.info("Opponent reconnected"); } });
        socket.on("connect_error",  (_e: Error) => { if (mounted) { setSocketError("Connection lost — reconnecting…"); toast.warn("Connection lost — moves may be delayed"); } });
        socket.on("reconnect", () => {
          if (!mounted) return;
          setSocketError(null);
          toast.info("Reconnected");
          setStatus(prev => {
            if (prev !== "finished") socket.emit("join-game", gameId);
            return prev;
          });
        });
        socket.on("rematch-accepted", (data: { gameId: number }) => {
          if (mounted) window.location.href = `/play/game/${data.gameId}`;
        });
        socket.on("game-snapshot", (data: any) => {
          if (!mounted) return;
          handleGameUpdateRef.current(data);
          if (data.prepStartedAt) setPrepStartedAt(new Date(data.prepStartedAt));
          if (data.moveNumber !== undefined) setMoveNumber(data.moveNumber);
          if (data.lastMoveAt) {
            updateTimerSnapshotRef.current(new Date(data.lastMoveAt), data.player1Timebank ?? 60000, data.player2Timebank ?? 60000);
            if (data.timeRemainingOnMove !== undefined) setMoveTimeRemaining(data.timeRemainingOnMove);
          }
          if (data.status === "finished" && data.endReason) {
            setGameResult({ winnerId: data.winnerId ?? null, endReason: data.endReason, player1EloAfter: data.player1EloAfter, player2EloAfter: data.player2EloAfter, eloChange: data.eloChange });
          }
        });
      } catch (err) {
        if (mounted) setSocketError("Failed to connect to game server.");
      }
    };

    init();

    return () => {
      mounted = false;
      getSocket().then(s => {
        s.off("game-update"); s.off("game-snapshot"); s.off("connect_error");
        s.off("reconnect"); s.off("opponent-disconnected"); s.off("opponent-connected");
        s.off("rematch-accepted");
      }).catch(() => {});
    };
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Prep countdown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "prep" || !prepStartedAt) return;
    const t = setInterval(() => {
      setPrepTimeRemaining(Math.max(0, 60 - (Date.now() - prepStartedAt.getTime()) / 1000));
    }, 200);
    return () => clearInterval(t);
  }, [status, prepStartedAt]);

  // ─── Active game timer ─────────────────────────────────────────────────────
  const whiteIsPlayer1 = isWhite === isPlayer1;

  useEffect(() => {
    if (status !== "active") return;
    const tick = () => {
      const snap = timerSnapshot.current;
      if (!snap) return;
      const elapsed    = Date.now() - snap.lastMoveAt.getTime();
      const fenTurn    = chessRef.current.turn();
      const activeIsP1 = fenTurn === "w" ? whiteIsPlayer1 : !whiteIsPlayer1;
      setMoveTimeRemaining(Math.max(0, MOVE_TIME_LIMIT - elapsed));
      if (elapsed > MOVE_TIME_LIMIT) {
        const overage = elapsed - MOVE_TIME_LIMIT;
        if (activeIsP1) setPlayer1Timebank(Math.max(0, snap.player1Timebank - overage));
        else            setPlayer2Timebank(Math.max(0, snap.player2Timebank - overage));
      }
    };
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [status, whiteIsPlayer1]); // eslint-disable-line

  // ─── FEN helpers ───────────────────────────────────────────────────────────
  const expandRow   = (row: string) => { let r = ""; for (const c of row) r += /\d/.test(c) ? "1".repeat(+c) : c; return r; };
  const compressRow = (row: string) => { let r = "", n = 0; for (const c of row) { if (c === "1") n++; else { if (n) { r += n; n = 0; } r += c; } } if (n) r += n; return r; };

  const getPieceAt = (f: string, sq: string) => {
    const rank = parseInt(sq[1]); const file = sq.charCodeAt(0) - 97;
    const rows = f.split(" ")[0].split("/"); const ri = 8 - rank;
    if (ri < 0 || ri >= 8) return "1";
    return expandRow(rows[ri])[file] ?? "1";
  };

  const simulatePlace = (f: string, piece: string, sq: string) => {
    const rank = parseInt(sq[1]); const fi = sq.charCodeAt(0) - 97;
    const rows = f.split(" ")[0].split("/"); const ri = 8 - rank;
    let row = expandRow(rows[ri]);
    row = row.substring(0, fi) + piece + row.substring(fi + 1);
    rows[ri] = compressRow(row);
    return rows.join("/") + " w - - 0 1";
  };

  const hasIllegalBattery = (f: string) => {
    const rows = f.split(" ")[0].split("/").map(expandRow);
    const bi = isWhite ? 7 : 0; const fi = isWhite ? 6 : 1;
    for (let c = 0; c < 8; c++) {
      const a = rows[bi][c].toUpperCase(); const b = rows[fi][c].toUpperCase();
      if (a !== "1" && b !== "1" && ["Q","R"].includes(a) && ["Q","R"].includes(b)) return true;
    }
    for (let c = 0; c < 7; c++) {
      for (const [a, b] of [[rows[bi][c].toUpperCase(), rows[fi][c+1].toUpperCase()], [rows[bi][c+1].toUpperCase(), rows[fi][c].toUpperCase()]])
        if (a !== "1" && b !== "1" && ["Q","B"].includes(a) && ["Q","B"].includes(b)) return true;
    }
    return false;
  };

  const calculatePlacementSquares = useCallback((fenLetter: string) => {
    const legal: string[] = []; const illegal: string[] = [];
    const ownRanks = isWhite ? [1,2] : [7,8]; const pawnRank = isWhite ? 2 : 7;
    for (const r of ownRanks) {
      for (let f = 0; f < 8; f++) {
        const sq = String.fromCharCode(97+f) + r;
        if (fenLetter === "P" && r !== pawnRank)   { illegal.push(sq); continue; }
        if (getPieceAt(fen, sq) !== "1")           { illegal.push(sq); continue; }
        const tmp = simulatePlace(fen, isWhite ? fenLetter : fenLetter.toLowerCase(), sq);
        if (hasIllegalBattery(tmp)) illegal.push(sq); else legal.push(sq);
      }
    }
    return { legal, illegal };
  }, [fen, isWhite]); // eslint-disable-line

  const customSquareStyles = useMemo(() => {
    const s: Record<string, React.CSSProperties> = {};
    legalSquares.forEach(sq   => { s[sq] = { backgroundColor: "rgba(0,200,0,0.45)" }; });
    illegalSquares.forEach(sq => { s[sq] = { backgroundColor: "rgba(220,0,0,0.35)" }; });
    return s;
  }, [legalSquares, illegalSquares]);

  // ─── Action handlers ────────────────────────────────────────────────────────
  const handlePlace = async (fenLetter: string, square: string) => {
    const sel = pieceLibrary.find(p => p.fen === fenLetter);
    if (!sel || ownReady || sel.value > auxPoints) return;
    setActivePiece(null); setLegalSquares([]); setIllegalSquares([]);
    try {
      const res = await apiFetch(`/api/game/${gameId}/place`, { method: "POST", body: JSON.stringify({ piece: fenLetter, square }) });
      if (!res.ok) { const err = await res.json(); toast.error(err.error ?? "Failed to place piece"); }
    } catch { toast.error("Failed to place piece — please try again"); }
  };

  const handleReady = async () => {
    if (ownReady) return;
    try {
      const res = await apiFetch(`/api/game/${gameId}/ready`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); toast.error(err.error ?? "Failed to mark ready"); }
    } catch (err) { console.error("Ready error:", err); }
  };

  const submitMove = useCallback((from: Square, to: Square, promotion: string) => {
    isSubmittingMove.current = true;
    apiFetch(`/api/game/${gameId}/move`, { method: "POST", body: JSON.stringify({ from, to, promotion }) })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json();
          toast.warn(err.error ?? "Move rejected — board refreshed");
          const sr = await apiFetch(`/api/game/${gameId}/status`, { method: "GET" });
          if (sr.ok) handleGameUpdate(await sr.json());
        }
      })
      .catch(() => toast.error("Connection error — move may not have been recorded"))
      .finally(() => { isSubmittingMove.current = false; });
  }, [gameId, handleGameUpdate, toast]);

  const handlePromotionChoice = (p: string) => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion; setPendingPromotion(null);
    try { chessRef.current.move({ from, to, promotion: p }); setFen(chessRef.current.fen()); } catch {}
    submitMove(from, to, p);
  };

  const isPromotionMove = (from: Square, to: Square) => {
    const piece = chessRef.current.get(from);
    if (!piece || piece.type !== "p") return false;
    return (piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1");
  };

  const handlePieceDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }): boolean => {
    if (!targetSquare || status !== "active" || !isMyTurn || isSubmittingMove.current) return false;
    const from = sourceSquare as Square; const to = targetSquare as Square;
    try {
      const turn = chessRef.current.turn();
      if ((turn === "w" && !isWhite) || (turn === "b" && isWhite)) return false;
      if (isPromotionMove(from, to)) {
        chessRef.current.move({ from, to, promotion: "q" }); chessRef.current.undo();
        setPendingPromotion({ from, to }); return false;
      }
      chessRef.current.move({ from, to }); setFen(chessRef.current.fen());
      submitMove(from, to, "q"); return true;
    } catch { return false; }
  };

  const handleResign = async () => {
    if (!confirm("Resign this game?")) return;
    try {
      const res = await apiFetch(`/api/game/${gameId}/resign`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); toast.error(err.error ?? "Failed to resign"); }
    } catch { toast.error("Connection error — could not resign"); }
  };

  // ── Draw handlers ───────────────────────────────────────────────────────────
  const handleDrawOffer = async () => {
    if (drawSubmitting || !canOfferDraw) return;
    setDrawSubmitting(true);
    try {
      const res = await apiFetch(`/api/game/${gameId}/draw/offer`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); toast.warn(err.error ?? "Could not offer draw"); }
    } catch { toast.error("Connection error — could not offer draw"); }
    finally { setDrawSubmitting(false); }
  };

  const handleDrawCancel = async () => {
    if (drawSubmitting) return;
    setDrawSubmitting(true);
    try {
      const res = await apiFetch(`/api/game/${gameId}/draw/cancel`, { method: "POST" });
      if (res.ok) setDrawOfferedBy(0);
    } catch { /* non-fatal */ }
    finally { setDrawSubmitting(false); }
  };

  const handleDrawAccept = async () => {
    if (drawSubmitting) return;
    setDrawSubmitting(true);
    try {
      const res = await apiFetch(`/api/game/${gameId}/draw/accept`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); toast.warn(err.error ?? "Could not accept draw"); }
    } catch { toast.error("Connection error"); }
    finally { setDrawSubmitting(false); }
  };

  const handleDrawDecline = async () => {
    if (drawSubmitting) return;
    setDrawSubmitting(true);
    try {
      const res = await apiFetch(`/api/game/${gameId}/draw/decline`, { method: "POST" });
      if (res.ok) setDrawOfferedBy(0);
    } catch { /* non-fatal */ }
    finally { setDrawSubmitting(false); }
  };

  // ── Rematch handlers ─────────────────────────────────────────────────────────
  const handleRematchOffer = async () => {
    if (rematchSubmitting) return;
    setRematchSubmitting(true);
    try {
      const res = await apiFetch(`/api/game/${gameId}/rematch/offer`, { method: "POST" });
      if (res.ok) {
        setRematchOfferedBy(myUserId);
        setRematchOfferedAt(Date.now());
        setRematchExpired(false);
        // The offer is always stored on the current finished game
        setRematchSourceGameId(gameId);
      } else {
        const err = await res.json();
        toast.warn(err.error ?? "Could not offer rematch");
      }
    } catch { toast.error("Connection error"); }
    finally { setRematchSubmitting(false); }
  };

  const handleRematchAccept = async () => {
    if (rematchSubmitting) return;
    setRematchSubmitting(true);
    try {
      // FIX: always POST to rematchSourceGameId, which was seeded on load
      // from the status API — not blindly from the current URL param.
      const res = await apiFetch(`/api/game/${rematchSourceGameId}/rematch/accept`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        toast.warn(err.error ?? "Could not accept rematch");
        setRematchSubmitting(false);
      }
      // On success the server emits rematch-accepted which triggers navigation
    } catch {
      toast.error("Connection error");
      setRematchSubmitting(false);
    }
  };

  const handleRematchDecline = async () => {
    if (rematchSubmitting) return;
    setRematchSubmitting(true);
    setRematchOfferedBy(0);
    try {
      await apiFetch(`/api/game/${rematchSourceGameId}/rematch/decline`, { method: "POST" });
    } catch { /* non-fatal */ }
    finally { setRematchSubmitting(false); }
  };

  // ─── Derived display ───────────────────────────────────────────────────────
  const prepPct           = (prepTimeRemaining / 60) * 100;
  const isLowPrep         = prepTimeRemaining <= 15;
  const myTimebankActive  = isMyTurn  && moveTimeRemaining === 0;
  const oppTimebankActive = !isMyTurn && moveTimeRemaining === 0;
  const largeDisplayMs    = isMyTurn
    ? (myTimebankActive  ? myTimebank  : moveTimeRemaining)
    : (oppTimebankActive ? oppTimebank : moveTimeRemaining);

  const endReasonLabels: Record<string, string> = {
    checkmate:             "Checkmate",
    stalemate:             "Stalemate",
    repetition:            "Threefold Repetition",
    insufficient_material: "Insufficient Material",
    draw:                  "Draw",
    draw_agreement:        "Draw by Agreement",
    timeout:               "Time Out",
    resignation:           "Resignation",
    abandoned:             "Abandoned",
  };

  // ─── PREP PHASE ────────────────────────────────────────────────────────────
  if (status === "prep") {
    return (
      <>
        <style>{`
          @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes pulseGold { 0%,100% { opacity:1; } 50% { opacity:.5; } }
          .slide-in { animation: slideIn 0.4s ease both; }
          .pulse-gold { animation: pulseGold 1.5s ease-in-out infinite; }
        `}</style>
        <div className="flex min-h-[calc(100vh-56px)] bg-[#0f1117]">
          <aside className="w-72 flex-shrink-0 bg-[#1a1d2e] border-r border-white/8 flex flex-col">
            <div className="px-6 pt-6 pb-5 border-b border-white/6">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-amber-400 pulse-gold" />
                <span className="text-xs font-bold uppercase tracking-widest text-amber-400">Prep Phase</span>
              </div>
              <p className="text-white/45 text-xs leading-relaxed">Place your extra pieces. Opponent can't see them yet.</p>
            </div>
            <div className="px-6 py-4 border-b border-white/6">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs text-white/35 uppercase tracking-wider">Time left</span>
                <span className={`font-display text-2xl font-700 tabular-nums ${isLowPrep ? "text-red-400" : "text-white"}`}>{Math.ceil(prepTimeRemaining)}s</span>
              </div>
              <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-200 ${isLowPrep ? "bg-red-500" : "bg-amber-400"}`} style={{ width: `${prepPct}%` }} />
              </div>
            </div>
            <div className="px-6 py-4 border-b border-white/6">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs text-white/35 uppercase tracking-wider">Points</span>
                <span className="font-display text-2xl font-700 tabular-nums text-white">{auxPoints}<span className="text-xs font-400 text-white/30 ml-1">/ {auxPointsMax}</span></span>
              </div>
              <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full bg-amber-400/70 transition-all duration-300" style={{ width: `${(auxPoints / auxPointsMax) * 100}%` }} />
              </div>
            </div>
            <div className="flex-1 px-6 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">Place a piece</p>
              <div className="space-y-2">
                {pieceLibrary.map(p => {
                  const canAfford = auxPoints >= p.value;
                  const isActive  = activePiece === p.ui;
                  return (
                    <button key={p.ui} disabled={(!canAfford && !isActive) || ownReady}
                      onClick={() => {
                        if (isActive) { setActivePiece(null); setLegalSquares([]); setIllegalSquares([]); }
                        else { setActivePiece(p.ui); const { legal, illegal } = calculatePlacementSquares(p.fen); setLegalSquares(legal); setIllegalSquares(illegal); }
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm transition-all duration-150 ${isActive ? "bg-amber-500/15 border-amber-500/50 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]" : canAfford && !ownReady ? "border-white/8 bg-white/[0.02] text-white/70 hover:bg-white/[0.06] hover:text-white hover:border-white/18 cursor-pointer" : "border-white/5 bg-transparent text-white/20 cursor-not-allowed"}`}>
                      <span className="text-2xl leading-none w-7 text-center">{p.symbol}</span>
                      <span className="flex-1 font-display font-600">{p.name}</span>
                      <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-md ${isActive ? "bg-amber-500/20 text-amber-400" : "bg-white/6 text-white/30"}`}>{p.value}pt</span>
                    </button>
                  );
                })}
              </div>
              {activePiece && <p className="text-[11px] text-amber-400/60 mt-3 text-center">↓ Click a highlighted square</p>}
            </div>
            <div className="px-6 py-3 border-t border-white/6">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${oppReady ? "bg-emerald-400" : "bg-white/20"}`} />
                <span className="text-xs text-white/40">{oppReady ? "Opponent is ready" : "Opponent is placing pieces..."}</span>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={handleReady} disabled={ownReady}
                className={`w-full py-3.5 rounded-xl font-display font-600 text-sm transition-all duration-200 ${ownReady ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 cursor-default" : "bg-amber-400 hover:bg-amber-300 text-[#0f1117] active:scale-[0.98] shadow-lg shadow-amber-500/20"}`}>
                {ownReady ? "✓ Ready — waiting for opponent" : "Lock in & Ready"}
              </button>
            </div>
          </aside>
          <main className="flex-1 flex flex-col items-center justify-center p-8 gap-5">
            {socketError && (
              <div className="w-full max-w-[600px] px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm text-center">⚠ {socketError}</div>
            )}
            <div className="text-center slide-in">
              <h1 className="font-display text-xl font-700 text-white/80 mb-0.5">Game <span className="text-amber-400">#{gameId}</span></h1>
              <p className="text-xs text-white/30">Playing as <span className="text-white/60">{isWhite ? "White ♔" : "Black ♚"}</span></p>
            </div>
            <div className="w-full max-w-[600px] rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.6)] slide-in">
              <Chessboard options={{ position: fen, boardOrientation: isWhite ? "white" : "black", onPieceDrag: () => {}, onPieceDrop: () => false, onSquareClick: ({ square }) => { if (!activePiece || ownReady) return; const s = pieceLibrary.find(p => p.ui === activePiece); if (s) handlePlace(s.fen, square); }, squareStyles: customSquareStyles }} />
            </div>
            <p className="text-xs text-white/20 text-center max-w-sm">Your placements are hidden from your opponent until the game starts</p>
          </main>
        </div>
      </>
    );
  }

  // ─── ACTIVE / FINISHED ─────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes slideIn    { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn     { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn    { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
        @keyframes flashBonus { 0%{opacity:0;transform:translateY(-4px)} 15%{opacity:1;transform:translateY(0)} 80%{opacity:1} 100%{opacity:0;transform:translateY(-8px)} }
        @keyframes timerPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes drawPulse  { 0%,100%{opacity:1} 50%{opacity:0.6} }
        .slide-in    { animation: slideIn 0.3s ease both; }
        .fade-in     { animation: fadeIn 0.4s ease both; }
        .scale-in    { animation: scaleIn 0.35s ease both; }
        .bonus-flash { animation: flashBonus 4s ease both; }
        .timer-urgent { animation: timerPulse 0.8s ease-in-out infinite; }
        .draw-pulse   { animation: drawPulse 2s ease-in-out infinite; }
      `}</style>

      {/* ── Game Result Overlay ──────────────────────────────────────────── */}
      {gameResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 fade-in">
          {(() => {
            const isWinner = gameResult.winnerId === myUserId;
            const isDraw   = gameResult.winnerId === null;
            const myElo    = isPlayer1 ? gameResult.player1EloAfter : gameResult.player2EloAfter;
            return (
              <div className="bg-[#1a1d2e] border border-white/12 rounded-3xl p-10 shadow-2xl text-center max-w-sm w-full mx-6 scale-in">
                <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center text-5xl mb-6 ${isDraw ? "bg-amber-500/15 border border-amber-500/30" : isWinner ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-red-500/10 border border-red-500/20"}`}>
                  {isDraw ? "=" : isWinner ? "♔" : "♚"}
                </div>
                <h2 className={`font-display text-4xl font-800 mb-1 ${isDraw ? "text-amber-400" : isWinner ? "text-emerald-400" : "text-white/70"}`}>
                  {isDraw ? "Draw" : isWinner ? "Victory" : "Defeat"}
                </h2>
                <p className="text-white/40 text-sm mb-7">{endReasonLabels[gameResult.endReason] ?? gameResult.endReason}</p>
                {myElo !== undefined && gameResult.eloChange !== undefined && (
                  <div className="flex items-center justify-center gap-3 mb-7 px-5 py-3 rounded-xl bg-white/[0.04] border border-white/8">
                    <span className="text-white/50 text-sm">Rating</span>
                    <span className="font-display font-700 text-white text-lg">{myElo}</span>
                    <span className={`text-sm font-600 px-2 py-0.5 rounded-full ${isWinner ? "bg-emerald-500/15 text-emerald-400" : isDraw ? "bg-white/8 text-white/50" : "bg-red-500/10 text-red-400"}`}>
                      {isWinner ? "+" : isDraw ? "±" : "−"}{gameResult.eloChange}
                    </span>
                  </div>
                )}
                {/* ── Rematch section ──────────────────────────────────────── */}
                <div className="mb-5">
                  {rematchOfferedBy === 0 && !rematchExpired && (
                    <button onClick={handleRematchOffer} disabled={rematchSubmitting}
                      className="w-full py-3 rounded-xl bg-white/[0.05] border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/8 text-white/60 hover:text-amber-400 font-display font-600 text-sm transition-all duration-200 disabled:opacity-40">
                      {rematchSubmitting ? "Sending…" : "Rematch"}
                    </button>
                  )}
                  {iHaveOfferedRematch && !rematchExpired && (
                    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 draw-pulse" />
                        <span className="text-xs text-white/50">Waiting for opponent</span>
                      </div>
                      <span className="font-display font-700 text-sm tabular-nums text-amber-400">
                        {Math.ceil(rematchCountdown / 1000)}s
                      </span>
                    </div>
                  )}
                  {opponentOfferedRematch && !rematchExpired && (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/6 px-4 py-3">
                      <p className="text-xs text-amber-400/80 mb-3 text-center">Opponent wants a rematch</p>
                      <div className="flex gap-2">
                        <button onClick={handleRematchAccept} disabled={rematchSubmitting}
                          className="flex-1 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-[#0f1117] font-display font-700 text-sm transition-colors disabled:opacity-50">
                          {rematchSubmitting ? "…" : "Accept"}
                        </button>
                        <button onClick={handleRematchDecline} disabled={rematchSubmitting}
                          className="flex-1 py-2.5 rounded-lg border border-white/10 hover:border-white/20 text-white/40 hover:text-white/60 font-display font-600 text-sm transition-all disabled:opacity-50">
                          Decline
                        </button>
                      </div>
                    </div>
                  )}
                  {rematchExpired && rematchOfferedBy === 0 && (
                    <p className="text-xs text-white/25 text-center py-1">Rematch offer expired</p>
                  )}
                </div>
                <div className="flex gap-3 justify-center">
                  <a href="/play/select" className="flex-1 py-3 bg-amber-400 hover:bg-amber-300 text-[#0f1117] font-display font-700 text-sm rounded-xl transition-colors text-center">Play Again</a>
                  <a href="/" className="flex-1 py-3 border border-white/12 hover:border-white/25 hover:bg-white/5 text-white/60 hover:text-white font-display font-600 text-sm rounded-xl transition-all text-center">Home</a>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {showTimebankBonus && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none bonus-flash">
          <div className="px-5 py-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-sm font-display font-600 shadow-xl">
            +60s added to both timers
          </div>
        </div>
      )}

      {opponentOfferedDraw && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-sm mx-auto px-4">
          <div className="rounded-2xl border border-white/12 bg-[#1a1d2e]/95 backdrop-blur-sm px-5 py-4 shadow-2xl scale-in">
            <p className="text-xs text-white/45 uppercase tracking-wider mb-3 text-center">Opponent offers a draw</p>
            <div className="flex gap-2">
              <button onClick={handleDrawAccept} disabled={drawSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 text-white/70 hover:text-white font-display font-600 text-sm transition-all disabled:opacity-40">
                {drawSubmitting ? "…" : "Accept draw"}
              </button>
              <button onClick={handleDrawDecline} disabled={drawSubmitting}
                className="flex-1 py-2.5 rounded-xl border border-white/8 text-white/35 hover:text-white/55 hover:border-white/15 font-display font-600 text-sm transition-all disabled:opacity-40">
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-[calc(100vh-56px)] bg-[#0f1117] flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[1000px] flex flex-col lg:flex-row gap-6 items-center lg:items-start">
          <div className="flex flex-col items-center gap-3 flex-1 min-w-0 w-full max-w-[600px]">
            <div className="w-full flex items-center justify-between gap-3 px-1 slide-in">
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${opponentConnected ? "bg-emerald-400" : "bg-red-400"}`} />
                <div className="w-8 h-8 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-lg">{isWhite ? "♚" : "♔"}</div>
                <div>
                  <p className="text-sm font-display font-600 text-white/80 leading-none">Opponent</p>
                  {!opponentConnected && <p className="text-[10px] text-red-400 mt-0.5">Reconnecting…</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">Bank</span>
                <span className={`font-display font-700 text-base tabular-nums transition-colors ${oppTimebankActive ? oppTimebank < 10000 ? "text-red-400" : oppTimebank < 20000 ? "text-orange-400" : "text-amber-400" : "text-white/60"}`}>
                  {formatTime(oppTimebank)}
                </span>
              </div>
            </div>

            <div className="relative w-full rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.7)] slide-in">
              <Chessboard options={{ position: fen, onPieceDrop: handlePieceDrop, boardOrientation: isWhite ? "white" : "black", squareStyles: customSquareStyles }} />
              {pendingPromotion && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center rounded-2xl z-10">
                  <div className="bg-[#1a1d2e] border border-white/12 rounded-2xl p-6 text-center scale-in">
                    <h3 className="font-display text-lg font-700 text-white mb-1">Promote Pawn</h3>
                    <p className="text-xs text-white/40 mb-5">Choose your piece</p>
                    <div className="flex gap-3">
                      {promotionPieces.map(({ piece, symbol, name }) => (
                        <button key={piece} onClick={() => handlePromotionChoice(piece)}
                          className="flex flex-col items-center p-4 rounded-xl border border-white/10 hover:border-amber-500/50 hover:bg-amber-500/8 transition-all group">
                          <span className="text-5xl leading-none mb-2">{symbol}</span>
                          <span className="text-[11px] text-white/40 group-hover:text-white/70">{name}</span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => { setPendingPromotion(null); setFen(chessRef.current.fen()); }}
                      className="mt-4 text-xs text-white/25 hover:text-white/50 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div className="w-full flex items-center justify-between gap-3 px-1 slide-in">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-lg">{isWhite ? "♔" : "♚"}</div>
                <div>
                  <p className="text-sm font-display font-600 text-white leading-none">You</p>
                  <p className="text-[10px] text-white/30 mt-0.5">{isWhite ? "White" : "Black"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">Bank</span>
                <span className={`font-display font-700 text-base tabular-nums ${myTimebank < 15000 ? "text-red-400" : myTimebank < 30000 ? "text-orange-400" : "text-white/70"}`}>
                  {formatTime(myTimebank)}
                </span>
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4 w-full lg:w-56 flex-shrink-0 slide-in">
            <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                  {status === "active"
                    ? isMyTurn ? myTimebankActive ? "Your timebank" : "Your move" : oppTimebankActive ? "Their timebank" : "Their move"
                    : "Game over"}
                </span>
                <span className="text-[10px] text-white/25 tabular-nums">#{moveNumber}</span>
              </div>
              {status === "active" && (
                <>
                  <div className={`font-display text-5xl font-800 tabular-nums leading-none mb-3 ${getTimerClass(largeDisplayMs, true)} ${largeDisplayMs < 8000 ? "timer-urgent" : ""}`}>
                    {formatTime(largeDisplayMs)}
                  </div>
                  <div className="h-1 rounded-full bg-white/6 overflow-hidden mb-2">
                    <div className={`h-full rounded-full transition-all duration-100 ${getTimerBarClass(moveTimeRemaining)}`} style={{ width: `${getTimerBarWidth(moveTimeRemaining)}%` }} />
                  </div>
                  <p className="text-[10px] text-white/25">
                    {isMyTurn ? myTimebankActive ? "Your timebank draining" : "Your move timer" : oppTimebankActive ? "Their timebank draining" : "Their move timer"}
                  </p>
                </>
              )}
              {status === "finished" && (
                <p className="text-2xl font-display font-700 text-white/40">Finished</p>
              )}
            </div>

            {socketError && (
              <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs text-center">
                ⚠ {socketError}
                <button onClick={() => window.location.reload()} className="block w-full mt-1 underline opacity-70 hover:opacity-100">Refresh</button>
              </div>
            )}

            <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-3">Game</p>
              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-white/35">ID</span>
                  <span className="font-display font-600 text-white/70">#{gameId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/35">Color</span>
                  <span className="font-display font-600 text-white/70">{isWhite ? "White" : "Black"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/35">Moves</span>
                  <span className="font-display font-600 text-white/70 tabular-nums">{moveNumber}</span>
                </div>
              </div>
            </div>

            {status === "active" && !gameResult && (
              <div className="rounded-2xl border border-white/8 bg-[#1a1d2e] p-4 flex flex-col gap-2">
                {drawOfferedBy === 0 && (
                  <button onClick={handleDrawOffer} disabled={drawSubmitting || !canOfferDraw}
                    title={drawCooldownRemaining > 0 ? `${drawCooldownRemaining} move${drawCooldownRemaining !== 1 ? "s" : ""} until you can offer again` : "Offer a draw"}
                    className="w-full py-2.5 rounded-xl border border-white/8 text-white/40 hover:text-white/65 hover:border-white/18 hover:bg-white/[0.04] font-display font-600 text-sm transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed">
                    {drawCooldownRemaining > 0
                      ? `Draw (${drawCooldownRemaining} move${drawCooldownRemaining !== 1 ? "s" : ""})`
                      : "Offer draw"}
                  </button>
                )}
                {iHaveOfferedDraw && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-white/30 draw-pulse flex-shrink-0" />
                      <span className="text-[11px] text-white/35">Draw offer sent</span>
                    </div>
                    <button onClick={handleDrawCancel} disabled={drawSubmitting}
                      className="w-full py-2 rounded-xl border border-white/8 text-white/30 hover:text-white/50 hover:border-white/14 font-display font-600 text-xs transition-all disabled:opacity-30">
                      Withdraw
                    </button>
                  </div>
                )}
              </div>
            )}

            {status === "active" && !gameResult && (
              <button onClick={handleResign}
                className="w-full py-3 rounded-xl border border-red-500/20 text-red-400/70 hover:border-red-500/40 hover:bg-red-500/8 hover:text-red-400 font-display font-600 text-sm transition-all duration-150">
                Resign
              </button>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
