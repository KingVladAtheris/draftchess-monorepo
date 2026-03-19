// apps/web/src/app/play/select/SelectClient.tsx
// CHANGES:
//   - Accepts `mode` and `budget` props so it works for all three game modes.
//   - DraftOption and QueuePanel display the correct per-mode point budget.
//   - Mode colour accent (amber=standard, sky=pauper, purple=royal).
"use client";

import { useState, useEffect, useRef } from "react";
import { getSocket } from "@/app/lib/socket";
import { apiFetch } from "@/app/lib/api-fetch";
import type { GameMode } from "@draftchess/shared/game-modes";

type Draft = { id: number; name: string | null; points: number; updatedAt: Date; };

function timeAgo(date: Date) {
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7)  return `${d}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const ACCENT = {
  standard: { bar: "bg-amber-400",  barMuted: "bg-white/25", selectedBorder: "border-amber-500/50 bg-amber-500/8",  checkBg: "bg-amber-400",  iconBg: "bg-amber-500/15 border-amber-500/25",  iconText: "text-amber-400",  queueBox: "bg-amber-500/8 border-amber-500/20",  queueText: "text-amber-400",  queueSub: "text-amber-400/50",  dots: "bg-amber-400"   },
  pauper:   { bar: "bg-sky-400",    barMuted: "bg-white/25", selectedBorder: "border-sky-500/50 bg-sky-500/8",      checkBg: "bg-sky-400",    iconBg: "bg-sky-500/15 border-sky-500/25",      iconText: "text-sky-400",    queueBox: "bg-sky-500/8 border-sky-500/20",      queueText: "text-sky-400",    queueSub: "text-sky-400/50",    dots: "bg-sky-400"     },
  royal:    { bar: "bg-purple-400", barMuted: "bg-white/25", selectedBorder: "border-purple-500/50 bg-purple-500/8",checkBg: "bg-purple-400", iconBg: "bg-purple-500/15 border-purple-500/25", iconText: "text-purple-400", queueBox: "bg-purple-500/8 border-purple-500/20", queueText: "text-purple-400", queueSub: "text-purple-400/50", dots: "bg-purple-400"  },
} as const;

function DraftOption({ draft, selected, disabled, onSelect, budget, mode }: {
  draft: Draft; selected: boolean; disabled: boolean; onSelect: () => void;
  budget: number; mode: GameMode;
}) {
  const pct = Math.min(100, (draft.points / budget) * 100);
  const a   = ACCENT[mode];
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left p-4 rounded-xl border transition-all duration-200
        ${disabled ? "opacity-60 cursor-not-allowed" :
          selected ? `${a.selectedBorder} cursor-pointer` :
          "border-white/8 bg-white/[0.02] hover:border-white/18 hover:bg-white/[0.05] cursor-pointer"}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={`font-display font-600 text-sm truncate ${selected ? a.iconText : "text-white/80"}`}>
          {draft.name || `Draft #${draft.id}`}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {selected && (
            <span className={`w-4 h-4 rounded-full ${a.checkBg} text-[#0f1117] flex items-center justify-center text-[9px] font-bold`}>✓</span>
          )}
          <span className="text-xs text-white/30">{timeAgo(draft.updatedAt)}</span>
        </div>
      </div>
      <div className="h-0.5 rounded-full bg-white/8 overflow-hidden mb-2">
        <div className={`h-full rounded-full ${selected ? a.bar : a.barMuted}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-white/35">{draft.points}/{budget} pts</span>
    </button>
  );
}

function QueuePanel({ selectedDraft, isQueuing, onQueue, onLeave, budget, mode, isChallengeMode }: {
  selectedDraft: Draft | null; isQueuing: boolean; onQueue: () => void; onLeave: () => void;
  budget: number; mode: GameMode; isChallengeMode?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const a = ACCENT[mode];

  useEffect(() => {
    if (!isQueuing) { setElapsed(0); startRef.current = null; return; }
    startRef.current = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current!) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isQueuing]);

  const fmt = (s: number) => { const m = Math.floor(s/60); return m > 0 ? `${m}:${(s%60).toString().padStart(2,"0")}` : `${s}s`; };

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-3">Playing with</p>
        {selectedDraft ? (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/8">
            <div className={`w-9 h-9 rounded-lg ${a.iconBg} border flex items-center justify-center ${a.iconText} text-xl flex-shrink-0`}>♟</div>
            <div className="min-w-0">
              <p className="text-sm font-600 font-display text-white truncate">{selectedDraft.name || `Draft #${selectedDraft.id}`}</p>
              <p className="text-xs text-white/35">{selectedDraft.points}/{budget} pts</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-dashed border-white/10">
            <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-white/20 text-xl flex-shrink-0">?</div>
            <p className="text-sm text-white/30 italic">No draft selected</p>
          </div>
        )}
      </div>

      {isQueuing && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${a.queueBox} border`}>
          <div className="flex gap-0.5 items-end h-4">
            {[0,1,2].map(i => (
              <div key={i} className={`w-1 rounded-full ${a.dots} animate-bounce`} style={{ height: "100%", animationDelay: `${i*0.15}s` }} />
            ))}
          </div>
          <div>
            <p className={`text-xs font-semibold ${a.queueText}`}>Searching for opponent</p>
            <p className={`text-xs ${a.queueSub} tabular-nums`}>{fmt(elapsed)}</p>
          </div>
        </div>
      )}

      {isQueuing ? (
        <button onClick={onLeave} className="btn-danger w-full py-3">Leave Queue</button>
      ) : (
        <button onClick={onQueue} disabled={!selectedDraft} className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed">
          {isChallengeMode ? "Accept Challenge" : "Find a match"}
        </button>
      )}

      {!isQueuing && !selectedDraft && (
        <p className="text-xs text-white/30 text-center -mt-2">Select a draft to continue</p>
      )}
    </div>
  );
}

export default function SelectClient({ drafts, mode, budget, isChallengeMode = false, challengeId = null }: {
  drafts: Draft[];
  mode:   GameMode;
  budget: number;
  isChallengeMode?: boolean;
  challengeId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isQueuing, setIsQueuing]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const didLeaveRef                 = useRef(false);
  const isQueuingRef                = useRef(false);

  

  useEffect(() => { isQueuingRef.current = isQueuing; }, [isQueuing]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/queue/status")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!mounted || !data) return;
        if (data.matched && data.gameId) { window.location.href = `/play/game/${data.gameId}`; return; }
        if (data.status === "queued") { setIsQueuing(true); attachSocket(); }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (isQueuingRef.current && !didLeaveRef.current) {
        fetch("/api/queue/leave", {
          method:    "POST",
          keepalive: true,
          headers:   { "x-draftchess-csrf": "1" },
        }).catch(() => {});
        getSocket().then(s => s.emit("leave-queue")).catch(() => {});
      }
    };
  }, []);

  function attachSocket() {
    getSocket().then(socket => {
      socket.emit("join-queue");
      socket.off("matched");
      socket.on("matched", (data: { gameId: number }) => {
        didLeaveRef.current = true; setIsQueuing(false);
        window.location.href = `/play/game/${data.gameId}`;
      });
      socket.off("queue-error");
      socket.on("queue-error", (msg: string) => { setError(msg); setIsQueuing(false); });
    }).catch(() => { setError("Could not connect to matchmaking server"); setIsQueuing(false); });
  }

  const handleQueue = async () => {
    if (!selectedId || isQueuing) return;
    setError(null);
    try {
      const res = await apiFetch("/api/queue/join", {
        method: "POST",
        body:   JSON.stringify({ draftId: selectedId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed to join queue"); }
      didLeaveRef.current = false; setIsQueuing(true); attachSocket();
    } catch (e: any) { setError(e.message); }
  };

  const handleChallengeAccept = async () => {
    if (!selectedId || !challengeId) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/challenges/${challengeId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "accept", draftId: selectedId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed to accept challenge"); }
      const data = await res.json();
      if (data.gameId) window.location.href = `/play/game/${data.gameId}`;
    } catch (e: any) { setError(e.message); }
  };

  const handleLeave = async () => {
    didLeaveRef.current = true; setIsQueuing(false);
    await apiFetch("/api/queue/leave", { method: "POST" }).catch(() => {});
    getSocket().then(s => { s.emit("leave-queue"); s.off("matched"); s.off("queue-error"); }).catch(() => {});
  };

  const modeLabel = mode === "standard" ? "Standard" : mode === "pauper" ? "Pauper" : "Royal";
  const modeDesc  = mode === "standard"
    ? "33pt army · 6 aux points — the classic format."
    : mode === "pauper"
    ? "18pt army · 3 aux points — lean and tactical."
    : "48pt army · 12 aux points — the full arsenal.";

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-800 text-white">{modeLabel} — Find a match</h1>
        <p className="text-white/45 text-sm mt-1">{modeDesc}</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className={`flex-1 min-w-0 transition-opacity duration-200 ${isQueuing ? "opacity-50 pointer-events-none" : ""}`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-3">Your {modeLabel} drafts</p>
          {drafts.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center rounded-2xl border border-dashed border-white/10">
              <p className="text-white/40 text-sm mb-2">No {modeLabel} drafts yet.</p>
              <p className="text-white/25 text-xs mb-6">Create one from the Drafts page to play this mode.</p>
              <a href="/drafts" className="btn-secondary py-2 px-5 text-sm">Go to Drafts</a>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {drafts.map(draft => (
                <DraftOption
                  key={draft.id}
                  draft={draft}
                  selected={selectedId === draft.id}
                  disabled={isQueuing}
                  onSelect={() => setSelectedId(draft.id)}
                  budget={budget}
                  mode={mode}
                />
              ))}
            </div>
          )}
        </div>

        <div className="w-full lg:w-72 flex-shrink-0 lg:sticky lg:top-20">
          <QueuePanel
            selectedDraft={drafts.find(d => d.id === selectedId) ?? null}
            isQueuing={isQueuing}
            onQueue={isChallengeMode ? handleChallengeAccept : handleQueue}
            onLeave={handleLeave}
            budget={budget}
            mode={mode}
            isChallengeMode={isChallengeMode}
          />
        </div>
      </div>
    </div>
  );
}
