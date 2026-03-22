"use client";
// apps/web/src/app/profile/[username]/ProfileClient.tsx
//
// CHANGES:
// 1. Added LiveGame type and liveGame prop
// 2. Added LiveGameSection component
// 3. Rendered <LiveGameSection> in OverviewTab above recent games
// 4. GameRow already has Replay → link — no change needed there

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api-fetch";
import { MODE_CONFIG } from "@draftchess/shared/game-modes";

// ─── Types ─────────────────────────────────────────────────────────────────
type GameMode = "standard" | "pauper" | "royal";

type Token = {
  slug: string; label: string; description: string | null;
  icon: string | null; color: string | null; grantedAt: string;
};

type ModeStats = { played: number; wins: number; losses: number; draws: number };

type Profile = {
  id: number; username: string; name: string | null; image: string | null;
  createdAt: string;
  elo:   { standard: number; pauper: number; royal: number };
  stats: { standard: ModeStats; pauper: ModeStats; royal: ModeStats };
  tokens: Token[];
  followerCount: number; followingCount: number;
};

type Game = {
  id: number; mode: GameMode; createdAt: string;
  result: "win" | "loss" | "draw"; endReason: string | null;
  opponent: { id: number; username: string };
  eloBefore: number | null; eloAfter: number | null; eloChange: number | null;
};

// ── NEW ──────────────────────────────────────────────────────────────────────
type LiveGame = {
  id:      number;
  status:  string;
  mode:    string;
  player1: { id: number; username: string };
  player2: { id: number; username: string };
};
// ─────────────────────────────────────────────────────────────────────────────

type EloPoint = { date: string; elo: number };

type FriendStatus = "none" | "pending_sent" | "pending_received" | "friends";

type Props = {
  profile: Profile;
  games: Game[];
  eloHistory: { standard: EloPoint[]; pauper: EloPoint[]; royal: EloPoint[] };
  liveGame: LiveGame | null; // ── NEW
  isOwnProfile: boolean;
  isFollowing: boolean;
  friendStatus: FriendStatus;
  friendRequestId: number | null;
  viewerId: number | null;
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const MODE_LABEL: Record<GameMode, string> = { standard: "Standard", pauper: "Pauper", royal: "Royal" };
const MODE_COLOR: Record<GameMode, string> = {
  standard: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  pauper:   "text-sky-400 bg-sky-400/10 border-sky-400/20",
  royal:    "text-violet-400 bg-violet-400/10 border-violet-400/20",
};
const MODE_ELO_COLOR: Record<GameMode, string> = {
  standard: "#f59e0b",
  pauper:   "#38bdf8",
  royal:    "#a78bfa",
};

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function winRate(stats: ModeStats) {
  if (stats.played === 0) return 0;
  return Math.round((stats.wins / stats.played) * 100);
}

// ─── Mini ELO Sparkline ────────────────────────────────────────────────────
function EloSparkline({ points, color, height = 40 }: { points: EloPoint[]; color: string; height?: number }) {
  if (points.length < 2) return <div className="text-white/20 text-xs">No data</div>;
  const elos  = points.map(p => p.elo);
  const min   = Math.min(...elos);
  const max   = Math.max(...elos);
  const range = max - min || 1;
  const w     = 120;
  const h     = height;
  const xs    = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys    = elos.map(e => h - ((e - min) / range) * (h - 4) - 2);
  const d     = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fill  = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#grad-${color.replace("#","")})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Full ELO Chart ────────────────────────────────────────────────────────
function EloChart({ points, color, mode }: { points: EloPoint[]; color: string; mode: string }) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 rounded-xl border border-white/8 bg-white/[0.02]">
        <p className="text-white/30 text-sm">No {mode} games played yet</p>
      </div>
    );
  }
  const elos  = points.map(p => p.elo);
  const min   = Math.min(...elos) - 20;
  const max   = Math.max(...elos) + 20;
  const range = max - min;
  const w     = 600;
  const h     = 140;
  const pad   = { l: 48, r: 16, t: 12, b: 24 };
  const iw    = w - pad.l - pad.r;
  const ih    = h - pad.t - pad.b;

  const xs = points.map((_, i) => pad.l + (i / (points.length - 1)) * iw);
  const ys = elos.map(e => pad.t + ih - ((e - min) / range) * ih);
  const d  = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fill = `${d} L${pad.l + iw},${pad.t + ih} L${pad.l},${pad.t + ih} Z`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + (range / ticks) * i);

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`chart-grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((tick, i) => {
          const y = pad.t + ih - ((tick - min) / range) * ih;
          return (
            <g key={i}>
              <line x1={pad.l} y1={y} x2={pad.l + iw} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.3)">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}
        <path d={fill} fill={`url(#chart-grad-${mode})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r="3.5" fill={color} />
        <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r="6" fill={color} fillOpacity="0.2" />
      </svg>
    </div>
  );
}

// ─── Token Badge ───────────────────────────────────────────────────────────
function TokenBadge({ token, size = "sm" }: { token: Token; size?: "sm" | "lg" }) {
  const color = token.color ?? "#f59e0b";
  if (size === "sm") {
    return (
      <div className="relative group">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-base border cursor-default"
          style={{ background: `${color}18`, borderColor: `${color}35`, color }}
        >
          {token.icon ?? "🏅"}
        </div>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md bg-[#1a1d2e] border border-white/10 text-xs text-white/80 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
          {token.label}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border bg-white/[0.02]"
      style={{ borderColor: `${color}25` }}>
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 border"
        style={{ background: `${color}18`, borderColor: `${color}35`, color }}
      >
        {token.icon ?? "🏅"}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-white text-sm" style={{ color }}>{token.label}</p>
        {token.description && <p className="text-white/50 text-xs mt-0.5">{token.description}</p>}
        <p className="text-white/25 text-xs mt-1">Granted {timeAgo(token.grantedAt)}</p>
      </div>
    </div>
  );
}

// ─── Stat Bar ──────────────────────────────────────────────────────────────
function StatBar({ stats, mode }: { stats: ModeStats; mode: GameMode }) {
  const total    = stats.played;
  const wr       = winRate(stats);
  const winPct   = total ? (stats.wins   / total) * 100 : 0;
  const lossPct  = total ? (stats.losses / total) * 100 : 0;
  const drawPct  = total ? (stats.draws  / total) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/40 uppercase tracking-wider font-semibold">{MODE_LABEL[mode]}</span>
        <span className="text-white/60">{total} games · {wr}% WR</span>
      </div>
      {total > 0 ? (
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          <div className="bg-emerald-500 rounded-l-full" style={{ width: `${winPct}%` }} />
          <div className="bg-white/20" style={{ width: `${drawPct}%` }} />
          <div className="bg-red-500/70 rounded-r-full" style={{ width: `${lossPct}%` }} />
        </div>
      ) : (
        <div className="h-2 rounded-full bg-white/8" />
      )}
      <div className="flex gap-4 text-xs text-white/40">
        <span className="text-emerald-400">{stats.wins}W</span>
        <span className="text-white/30">{stats.draws}D</span>
        <span className="text-red-400/70">{stats.losses}L</span>
      </div>
    </div>
  );
}

// ─── Game Row ──────────────────────────────────────────────────────────────
function GameRow({ game }: { game: Game }) {
  const resultColor = game.result === "win" ? "text-emerald-400" : game.result === "loss" ? "text-red-400/80" : "text-white/40";
  const resultLabel = game.result === "win" ? "Win" : game.result === "loss" ? "Loss" : "Draw";
  const eloColor    = game.eloChange === null ? "" : game.eloChange > 0 ? "text-emerald-400" : game.eloChange < 0 ? "text-red-400/80" : "text-white/40";
  const eloStr      = game.eloChange === null ? "—" : game.eloChange > 0 ? `+${game.eloChange}` : `${game.eloChange}`;

  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/6 bg-white/[0.015] hover:bg-white/[0.03] transition-colors">
      <span className={`w-10 text-sm font-bold ${resultColor}`}>{resultLabel}</span>
      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${MODE_COLOR[game.mode]}`}>
        {MODE_LABEL[game.mode]}
      </span>
      <Link href={`/profile/${game.opponent.username}`} className="flex-1 text-sm text-white/70 hover:text-white transition-colors truncate min-w-0">
        vs <span className="font-medium">{game.opponent.username}</span>
      </Link>
      <span className="text-xs text-white/30 flex-shrink-0">{game.endReason?.replace("_", " ") ?? ""}</span>
      <span className={`text-sm font-semibold w-12 text-right flex-shrink-0 ${eloColor}`}>{eloStr}</span>
      <span className="text-xs text-white/25 flex-shrink-0 w-16 text-right">{timeAgo(game.createdAt)}</span>
      <Link
        href={`/play/game/${game.id}/replay`}
        className="text-xs text-amber-400/60 hover:text-amber-400 transition-colors flex-shrink-0"
      >
        Replay →
      </Link>
    </div>
  );
}

// ── NEW: Live Game Section ─────────────────────────────────────────────────
function LiveGameSection({ liveGame }: { liveGame: LiveGame | null }) {
  if (!liveGame) return null;

  const modeLabel = (MODE_LABEL as Record<string, string>)[liveGame.mode] ?? liveGame.mode;
  const modeColor =
    liveGame.mode === "royal"  ? "text-violet-400 bg-violet-400/10 border-violet-400/20" :
    liveGame.mode === "pauper" ? "text-sky-400 bg-sky-400/10 border-sky-400/20" :
                                  "text-amber-400 bg-amber-400/10 border-amber-400/20";

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <p className="text-xs font-bold uppercase tracking-widest text-red-400">Playing right now</p>
      </div>

      <div className="flex items-center gap-3 py-3 px-4 rounded-xl border border-red-500/15 bg-red-500/[0.04] hover:bg-red-500/[0.07] transition-colors">
        {/* Mode badge */}
        <span className={`text-xs px-2 py-0.5 rounded-md border font-medium flex-shrink-0 ${modeColor}`}>
          {modeLabel}
        </span>

        {/* Players */}
        <div className="flex-1 flex items-center gap-1.5 text-sm text-white/70 min-w-0">
          <Link href={`/profile/${liveGame.player1.username}`} className="font-medium hover:text-white transition-colors truncate">
            {liveGame.player1.username}
          </Link>
          <span className="text-white/25 flex-shrink-0">vs</span>
          <Link href={`/profile/${liveGame.player2.username}`} className="font-medium hover:text-white transition-colors truncate">
            {liveGame.player2.username}
          </Link>
        </div>

        {/* Live badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/25 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-bold text-red-400">Live</span>
        </div>

        {/* Watch link */}
        <Link
          href={`/play/game/${liveGame.id}/watch`}
          className="text-xs text-white/40 hover:text-white/70 transition-colors flex-shrink-0 flex items-center gap-1"
        >
          Watch →
        </Link>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Tab: Overview ─────────────────────────────────────────────────────────
// ── CHANGED: accepts liveGame and passes to LiveGameSection ──────────────────
function OverviewTab({ profile, games, eloHistory, liveGame }: {
  profile: Profile;
  games: Game[];
  eloHistory: Props["eloHistory"];
  liveGame: LiveGame | null; // ── NEW
}) {
  const modes: GameMode[] = ["standard", "pauper", "royal"];
  return (
    <div className="space-y-8">
      {/* ELO cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {modes.map(mode => (
          <div key={mode} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${MODE_COLOR[mode]}`}>
                {MODE_LABEL[mode]}
              </span>
              <EloSparkline points={eloHistory[mode]} color={MODE_ELO_COLOR[mode]} />
            </div>
            <p className="text-2xl font-bold text-white">{profile.elo[mode]}</p>
            <p className="text-xs text-white/35 mt-0.5">{profile.stats[mode].played} games · {winRate(profile.stats[mode])}% WR</p>
          </div>
        ))}
      </div>

      {/* Tokens */}
      {profile.tokens.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-3">Tokens</p>
          <div className="flex flex-wrap gap-2">
            {profile.tokens.map(t => <TokenBadge key={t.slug} token={t} size="sm" />)}
          </div>
        </div>
      )}

      {/* ── NEW: Live game above recent games ────────────────────────────── */}
      <LiveGameSection liveGame={liveGame} />

      {/* Recent games */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-3">Recent games</p>
        {games.length === 0 ? (
          <p className="text-white/30 text-sm">No games played yet.</p>
        ) : (
          <div className="space-y-2">
            {games.slice(0, 5).map(g => <GameRow key={g.id} game={g} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Games ────────────────────────────────────────────────────────────
function GamesTab({ games }: { games: Game[] }) {
  const [filter, setFilter] = useState<GameMode | "all">("all");
  const filtered = filter === "all" ? games : games.filter(g => g.mode === filter);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["all", "standard", "pauper", "royal"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              filter === f ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-white/8 text-white/40 hover:text-white/60"
            }`}>
            {f === "all" ? "All" : MODE_LABEL[f]}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-white/30 text-sm py-8 text-center">No games found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(g => <GameRow key={g.id} game={g} />)}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Stats ────────────────────────────────────────────────────────────
function StatsTab({ profile, eloHistory }: { profile: Profile; eloHistory: Props["eloHistory"] }) {
  const [activeMode, setActiveMode] = useState<GameMode>("standard");
  const modes: GameMode[] = ["standard", "pauper", "royal"];
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {modes.map(m => (
          <button key={m} onClick={() => setActiveMode(m)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              activeMode === m ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-white/8 text-white/40 hover:text-white/60"
            }`}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "ELO",      value: profile.elo[activeMode] },
          { label: "Games",    value: profile.stats[activeMode].played },
          { label: "Win rate", value: `${winRate(profile.stats[activeMode])}%` },
          { label: "Wins",     value: profile.stats[activeMode].wins },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <p className="text-xs text-white/35 uppercase tracking-wider mb-1">{s.label}</p>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-3">
          {MODE_LABEL[activeMode]} ELO over time
        </p>
        <EloChart points={eloHistory[activeMode]} color={MODE_ELO_COLOR[activeMode]} mode={activeMode} />
      </div>

      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/35">All modes</p>
        {modes.map(m => <StatBar key={m} stats={profile.stats[m]} mode={m} />)}
      </div>
    </div>
  );
}

// ─── Shared: Social user row ───────────────────────────────────────────────
type SocialUser = {
  id: number; username: string; image: string | null;
  eloStandard: number; eloPauper: number; eloRoyal: number; online: boolean;
};

function SocialUserRow({ user }: { user: SocialUser }) {
  return (
    <Link
      href={`/profile/${user.username}`}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/6 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/12 transition-all group"
    >
      <div className="relative flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-sm font-bold">
          {user.image
            ? <img src={user.image} alt={user.username} className="w-full h-full rounded-full object-cover" />
            : user.username[0].toUpperCase()
          }
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0f1117] ${user.online ? "bg-emerald-400" : "bg-white/20"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors truncate">{user.username}</p>
        <p className="text-[11px] text-white/30 mt-0.5">{user.online ? "Online" : "Offline"} · {user.eloStandard} ELO</p>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
        {[
          { label: "S", elo: user.eloStandard },
          { label: "P", elo: user.eloPauper },
          { label: "R", elo: user.eloRoyal },
        ].map(m => (
          <div key={m.label} className="flex flex-col items-center px-2 py-1 rounded-lg bg-white/[0.04] border border-white/6">
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/25">{m.label}</span>
            <span className="text-xs font-bold text-white/60 tabular-nums">{m.elo}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function useSocialList(url: string) {
  const [users, setUsers]     = useState<SocialUser[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const list: SocialUser[] = data.friends ?? data.following ?? [];
        list.sort((a, b) => {
          if (a.online !== b.online) return a.online ? -1 : 1;
          return a.username.localeCompare(b.username);
        });
        setUsers(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [url]);
  return { users, loading };
}

// ─── Tab: Friends ──────────────────────────────────────────────────────────
function FriendsTab({ isOwnProfile }: { isOwnProfile: boolean }) {
  const { users, loading } = useSocialList("/api/friends");
  if (!isOwnProfile) return <p className="text-white/30 text-sm py-8 text-center">Friends list is only visible to the account owner.</p>;
  if (loading) return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />)}</div>;
  if (users.length === 0) return <p className="text-white/25 text-sm py-8 text-center">No friends yet.</p>;
  const online = users.filter(u => u.online);
  return (
    <div className="space-y-4">
      <p className="text-xs text-white/30 font-medium">{users.length} friend{users.length !== 1 ? "s" : ""} · {online.length} online</p>
      <div className="space-y-2">{users.map(u => <SocialUserRow key={u.id} user={u} />)}</div>
    </div>
  );
}

// ─── Tab: Following ────────────────────────────────────────────────────────
function FollowingTab({ username, isOwnProfile }: { username: string; isOwnProfile: boolean }) {
  const url = isOwnProfile ? "/api/following" : `/api/profile/${username}/following`;
  const { users, loading } = useSocialList(url);
  if (loading) return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />)}</div>;
  if (users.length === 0) return <p className="text-white/25 text-sm py-8 text-center">{isOwnProfile ? "You aren't following anyone yet." : "Not following anyone."}</p>;
  const online = users.filter(u => u.online);
  return (
    <div className="space-y-4">
      <p className="text-xs text-white/30 font-medium">{users.length} following · {online.length} online</p>
      <div className="space-y-2">{users.map(u => <SocialUserRow key={u.id} user={u} />)}</div>
    </div>
  );
}

// ─── Tab: Tokens ───────────────────────────────────────────────────────────
function TokensTab({ tokens }: { tokens: Token[] }) {
  if (tokens.length === 0) return <p className="text-white/30 text-sm py-8 text-center">No tokens yet.</p>;
  return <div className="space-y-3">{tokens.map(t => <TokenBadge key={t.slug} token={t} size="lg" />)}</div>;
}

// ─── ChallengeDropdown ─────────────────────────────────────────────────────
function ChallengeDropdown({
  profileId, challengeMode, challengeDraftId, challengeDrafts,
  challengeLoading, challengeSent,
  onOpen, onModeChange, onDraftChange, onSend,
}: {
  profileId: number;
  challengeMode: GameMode;
  challengeDraftId: number | null;
  challengeDrafts: { id: number; name: string | null }[];
  challengeLoading: boolean;
  challengeSent: boolean;
  onOpen: (mode: GameMode) => void;
  onModeChange: (mode: GameMode) => void;
  onDraftChange: (id: number | null) => void;
  onSend: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open) onOpen(challengeMode);
    setOpen(o => !o);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={handleToggle} className="px-4 py-2 rounded-xl text-sm font-semibold border border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-all">
        ⚔ Challenge
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-72 z-50 bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60 p-4 flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-white/40">Send Challenge</p>
          <p className="text-[11px] text-white/25">Casual game · no ELO impact</p>
          <div className="flex gap-1.5">
            {(["standard", "pauper", "royal"] as GameMode[]).map(m => (
              <button key={m} onClick={() => onModeChange(m)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  challengeMode === m
                    ? m === "royal"  ? "bg-purple-500/20 border-purple-500/40 text-purple-400"
                    : m === "pauper" ? "bg-sky-500/20 border-sky-500/40 text-sky-400"
                    :                  "bg-amber-500/20 border-amber-500/40 text-amber-400"
                    : "border-white/10 text-white/40 hover:border-white/20"
                }`}>
                {MODE_CONFIG[m].label}
              </button>
            ))}
          </div>
          <div>
            <p className="text-[10px] text-white/35 mb-1.5">Your draft (optional)</p>
            <select
              value={challengeDraftId ?? ""}
              onChange={e => onDraftChange(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 focus:outline-none focus:border-white/25"
            >
              <option value="">— No draft selected —</option>
              {challengeDrafts.map(d => <option key={d.id} value={d.id}>{d.name || `Draft #${d.id}`}</option>)}
            </select>
          </div>
          {challengeSent ? (
            <p className="text-center text-emerald-400 text-sm font-semibold">✓ Challenge sent!</p>
          ) : (
            <button onClick={onSend} disabled={challengeLoading}
              className="w-full py-2 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 text-sm font-semibold hover:bg-purple-500/25 transition-all disabled:opacity-50">
              {challengeLoading ? "Sending…" : "Send Challenge"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
type Tab = "overview" | "games" | "stats" | "friends" | "following" | "tokens";

export default function ProfileClient({
  profile, games, eloHistory,
  liveGame,            // ── NEW
  isOwnProfile, isFollowing, friendStatus: initialFriendStatus,
  friendRequestId: initialRequestId, viewerId,
}: Props) {
  const [activeTab, setActiveTab]               = useState<Tab>("overview");
  const [following, setFollowing]               = useState(isFollowing);
  const [followLoading, setFollowLoading]       = useState(false);
  const [friendStatus, setFriendStatus]         = useState<FriendStatus>(initialFriendStatus);
  const [friendRequestId, setFriendRequestId]   = useState<number | null>(initialRequestId);
  const [friendLoading, setFriendLoading]       = useState(false);
  const [challengeMode, setChallengeMode]       = useState<GameMode>("standard");
  const [challengeDraftId, setChallengeDraftId] = useState<number | null>(null);
  const [challengeDrafts, setChallengeDrafts]   = useState<{ id: number; name: string | null }[]>([]);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeSent, setChallengeSent]       = useState(false);

  const handleFriend = useCallback(async () => {
    if (!viewerId || friendLoading) return;
    setFriendLoading(true);
    try {
      if (friendStatus === "friends" || friendStatus === "pending_sent") {
        if (friendRequestId) {
          const res = await apiFetch(`/api/friends/${friendRequestId}`, { method: "DELETE" });
          if (res.ok) { setFriendStatus("none"); setFriendRequestId(null); }
        }
      } else if (friendStatus === "pending_received") {
        if (friendRequestId) {
          const res = await apiFetch(`/api/friends/${friendRequestId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "accept" }),
          });
          if (res.ok) setFriendStatus("friends");
        }
      } else {
        const res = await apiFetch("/api/friends/request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUserId: profile.id }),
        });
        if (res.ok) {
          const data = await res.json();
          setFriendStatus(data.status === "accepted" ? "friends" : "pending_sent");
          setFriendRequestId(data.requestId);
        }
      }
    } finally { setFriendLoading(false); }
  }, [viewerId, friendLoading, friendStatus, friendRequestId, profile.id]);

  const handleFollow = useCallback(async () => {
    if (!viewerId || followLoading) return;
    setFollowLoading(true);
    try {
      const res = await apiFetch(`/api/profile/${profile.username}/follow`, { method: "POST" });
      if (res.ok) { const data = await res.json(); setFollowing(data.following); }
    } finally { setFollowLoading(false); }
  }, [viewerId, followLoading, profile.username]);

  const fetchChallengeDrafts = useCallback(async (mode: GameMode) => {
    try {
      const res = await fetch(`/api/drafts?mode=${mode}`);
      if (res.ok) { const data = await res.json(); setChallengeDrafts(data.drafts ?? []); }
    } catch { /* non-fatal */ }
  }, []);

  const handleOpenChallenge = useCallback((mode: GameMode) => {
    setChallengeMode(mode);
    setChallengeDraftId(null);
    setChallengeSent(false);
    fetchChallengeDrafts(mode);
  }, [fetchChallengeDrafts]);

  const handleSendChallenge = useCallback(async () => {
    if (challengeLoading) return;
    setChallengeLoading(true);
    try {
      const res = await apiFetch("/api/challenges", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: profile.id, mode: challengeMode, draftId: challengeDraftId ?? undefined }),
      });
      if (res.ok) setChallengeSent(true);
    } finally { setChallengeLoading(false); }
  }, [challengeLoading, profile.id, challengeMode, challengeDraftId]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "games",    label: "Games"    },
    { key: "stats",    label: "Stats"    },
    { key: "friends",  label: "Friends"  },
    { key: "following",label: "Following"},
    { key: "tokens",   label: "Tokens"   },
  ];

  const joinedYear = new Date(profile.createdAt).getFullYear();

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-10">

      {/* Header */}
      <div className="flex items-start gap-5 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-2xl font-bold text-amber-400 flex-shrink-0">
          {profile.image
            ? <img src={profile.image} alt={profile.username} className="w-full h-full rounded-2xl object-cover" />
            : profile.username[0].toUpperCase()
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-2xl font-800 text-white">{profile.username}</h1>
            <div className="flex gap-1.5">
              {profile.tokens.slice(0, 4).map(t => <TokenBadge key={t.slug} token={t} size="sm" />)}
            </div>
          </div>
          {profile.name && <p className="text-white/45 text-sm mt-0.5">{profile.name}</p>}
          <p className="text-white/25 text-xs mt-1">Member since {joinedYear} · {profile.followerCount} followers</p>
        </div>
        {!isOwnProfile && viewerId && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleFriend} disabled={friendLoading}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                friendStatus === "friends"          ? "border-white/15 text-white/50 hover:border-red-500/30 hover:text-red-400/70" :
                friendStatus === "pending_sent"     ? "border-white/15 text-white/40" :
                friendStatus === "pending_received" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" :
                                                      "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              }`}>
              {friendLoading ? "..." :
                friendStatus === "friends"          ? "Friends" :
                friendStatus === "pending_sent"     ? "Request Sent" :
                friendStatus === "pending_received" ? "Accept Friend" : "Add Friend"}
            </button>
            {friendStatus === "friends" && (
              <ChallengeDropdown
                profileId={profile.id}
                challengeMode={challengeMode}
                challengeDraftId={challengeDraftId}
                challengeDrafts={challengeDrafts}
                challengeLoading={challengeLoading}
                challengeSent={challengeSent}
                onOpen={handleOpenChallenge}
                onModeChange={handleOpenChallenge}
                onDraftChange={setChallengeDraftId}
                onSend={handleSendChallenge}
              />
            )}
            <button onClick={handleFollow} disabled={followLoading}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                following
                  ? "border-white/15 text-white/50 hover:border-red-500/30 hover:text-red-400/70"
                  : "border-white/15 text-white/40 hover:border-white/25 hover:text-white/60"
              }`}>
              {followLoading ? "..." : following ? "Following" : "Follow"}
            </button>
          </div>
        )}
      </div>

      {/* Tab nav */}
      <div className="flex flex-wrap gap-1 border-b border-white/8 mb-8">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key ? "border-amber-400 text-amber-400" : "border-transparent text-white/40 hover:text-white/60"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview"  && <OverviewTab profile={profile} games={games} eloHistory={eloHistory} liveGame={liveGame} />}
      {activeTab === "games"     && <GamesTab games={games} />}
      {activeTab === "stats"     && <StatsTab profile={profile} eloHistory={eloHistory} />}
      {activeTab === "friends"   && <FriendsTab isOwnProfile={isOwnProfile} />}
      {activeTab === "following" && <FollowingTab username={profile.username} isOwnProfile={isOwnProfile} />}
      {activeTab === "tokens"    && <TokensTab tokens={profile.tokens} />}
    </div>
  );
}
