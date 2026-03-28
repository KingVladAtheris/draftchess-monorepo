"use client";

// apps/web/src/components/Nav.tsx
//
// CHANGES:
//   - NotificationsBell no longer polls every 30s.
//     Hydrates once on mount from GET /api/notifications.
//     Live updates arrive via the existing WebSocket connection:
//     socket server forwards draftchess:notifications channel messages
//     to queue-user-{userId} rooms as "notification" events.
//   - Per-notification dismiss button (hard delete via POST /api/notifications/[id]/dismiss).
//   - Dismiss all button (POST /api/notifications/dismiss-all).
//   - Bell open calls PUT /api/notifications/read to reset unread count.
//   - Notification shape now comes from the Notification table (id, type, payload, read, createdAt).

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { apiFetch } from "@/app/lib/api-fetch";
import { getSocket } from "@/app/lib/socket";

// ─── Icons ───────────────────────────────────────────────────────────────────
const ChevronDown = ({ className }: { className?: string }) => (
  <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6v2.5L2 10h12l-1.5-1.5V6A4.5 4.5 0 0 0 8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SoonPill = () => (
  <span className="ml-auto text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
    Soon
  </span>
);

// ─── Types ────────────────────────────────────────────────────────────────────
type DropdownItem =
  | { type: "link";   label: string; href: string;        soon?: boolean; danger?: boolean }
  | { type: "button"; label: string; onClick: () => void; soon?: boolean; danger?: boolean }
  | { type: "divider" };

// Notification as stored in the Notification table
type AppNotification = {
  id:        number;
  type:      string;
  payload:   Record<string, any>;
  read:      boolean;
  createdAt: string;
};

// ─── Shared dropdown panel ────────────────────────────────────────────────────
function DropdownPanel({ items, isOpen, align = "left" }: {
  items: DropdownItem[];
  isOpen: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={`
      absolute top-[calc(100%+8px)] min-w-[190px] z-50
      bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60
      overflow-hidden transition-all duration-150
      ${align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"}
      ${isOpen ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}
    `}>
      {items.map((item, i) => {
        if (item.type === "divider") return <div key={i} className="h-px bg-white/8 my-1" />;

        const cls = `flex items-center gap-2 w-full px-4 py-2.5 text-sm text-left transition-colors duration-100
          ${item.soon
            ? "text-white/30 cursor-not-allowed"
            : item.danger
              ? "text-red-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
              : "text-white/75 hover:bg-white/6 hover:text-white cursor-pointer"
          }`;

        if (item.type === "link") {
          return item.soon
            ? <div key={i} className={cls}><span>{item.label}</span><SoonPill /></div>
            : <Link key={i} href={item.href} className={cls}>{item.label}</Link>;
        }

        return (
          <button key={i} onClick={item.soon ? undefined : item.onClick} disabled={!!item.soon} className={cls}>
            <span>{item.label}</span>
            {item.soon && <SoonPill />}
          </button>
        );
      })}
    </div>
  );
}

// ─── Generic nav dropdown ─────────────────────────────────────────────────────
function NavDropdown({ label, items }: { label: string; items: DropdownItem[] }) {
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150
          ${open ? "text-white bg-white/8" : "text-white/60 hover:text-white hover:bg-white/6"}`}
      >
        {label}
        <ChevronDown className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <DropdownPanel items={items} isOpen={open} />
    </div>
  );
}

// ─── Notifications bell ───────────────────────────────────────────────────────
function NotificationsBell({ userId }: { userId: number }) {
  const [open, setOpen]                     = useState(false);
  const [notifications, setNotifications]   = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount]       = useState(0);
  const [loading, setLoading]               = useState(true);
  const [acting, setActing]                 = useState<number | string | null>(null);
  const ref                                 = useRef<HTMLDivElement>(null);

  // ── Hydrate on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/notifications")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Live push via WebSocket ────────────────────────────────────────────────
  // The socket server routes draftchess:notifications messages to
  // queue-user-{userId} rooms as "notification" events.
  useEffect(() => {
    let mounted = true;
    getSocket().then(socket => {
      socket.on("notification", (data: any) => {
        if (!mounted) return;
        // Auto-redirect to pick page when tournament round starts
        if (data.notificationType === 'tournament_pick_draft') {
          const { tournamentId, roundId } = data.payload ?? {}
          if (tournamentId && roundId) {
            window.location.href = `/tournaments/${tournamentId}/${roundId}/pick`
            return  // don't add to bell — they're being redirected
          }
        }
        const notif: AppNotification = {
          id:        data.notificationId ?? Date.now(),
          type:      data.notificationType ?? "unknown",
          payload:   data.payload ?? {},
          read:      false,
          createdAt: data.payload?.createdAt ?? new Date().toISOString(),
        };
        setNotifications(prev => [notif, ...prev]);
        setUnreadCount(prev => prev + 1);
      });
    }).catch(() => {});
    return () => {
      mounted = false;
      getSocket().then(s => s.off("notification")).catch(() => {});
    };
  }, []);

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Bell open → mark all read ──────────────────────────────────────────────
  const handleOpen = useCallback(() => {
    const wasOpen = open;
    setOpen(o => !o);
    if (!wasOpen && unreadCount > 0) {
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      apiFetch("/api/notifications", { method: "PUT" }).catch(() => {});
    }
  }, [open, unreadCount]);

  // ── Dismiss one ───────────────────────────────────────────────────────────
  const handleDismiss = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setActing(id);
    // Optimistic
    setNotifications(prev => prev.filter(n => n.id !== id));
    setUnreadCount(prev => {
      const notif = notifications.find(n => n.id === id);
      return notif && !notif.read ? Math.max(0, prev - 1) : prev;
    });
    await apiFetch(`/api/notifications/${id}/dismiss`, { method: "POST" }).catch(() => {});
    setActing(null);
  };

  // ── Dismiss all ───────────────────────────────────────────────────────────
  const handleDismissAll = async () => {
    setActing("all");
    setNotifications([]);
    setUnreadCount(0);
    await apiFetch("/api/notifications/dismiss-all", { method: "POST" }).catch(() => {});
    setActing(null);
  };

  // ── Action handlers (friend request / challenge) ───────────────────────────
  const handleFriendAction = async (requestId: number, notifId: number, action: "accept" | "decline") => {
    setActing(notifId);
    try {
      const res = await apiFetch(`/api/friends/${requestId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      });
      if (res.ok) {
        setNotifications(prev => prev.filter(n => n.id !== notifId));
        setUnreadCount(prev => {
          const notif = notifications.find(n => n.id === notifId);
          return notif && !notif.read ? Math.max(0, prev - 1) : prev;
        });
      }
    } finally {
      setActing(null);
    }
  };

  const handleChallengeAction = async (challengeId: number, notifId: number, action: "accept" | "decline", mode?: string) => {
    setActing(notifId);
    try {
      if (action === "decline") {
        const res = await apiFetch(`/api/challenges/${challengeId}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "decline" }),
        });
        if (res.ok) {
          setNotifications(prev => prev.filter(n => n.id !== notifId));
        }
        return;
      }
      // Accept — go to select page to pick a draft
      setNotifications(prev => prev.filter(n => n.id !== notifId));
      window.location.href = `/play/${mode ?? "standard"}?challengeId=${challengeId}`;
    } finally {
      setActing(null);
    }
  };

  // ── Render one notification row ───────────────────────────────────────────
  const renderNotification = (n: AppNotification) => {
    const p = n.payload;

    return (
      <div
        key={n.id}
        className={`relative px-4 py-3 border-b border-white/6 last:border-0 transition-colors ${
          !n.read ? "bg-white/[0.02]" : ""
        }`}
      >
        {/* Unread dot */}
        {!n.read && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-amber-400" />
        )}

        {/* Dismiss button */}
        <button
          onClick={(e) => handleDismiss(n.id, e)}
          disabled={acting === n.id}
          className="absolute top-3 right-3 p-1 rounded-md text-white/20 hover:text-white/50 hover:bg-white/6 transition-colors"
          aria-label="Dismiss"
        >
          <XIcon />
        </button>

        <div className="flex items-start gap-3 pr-6">
          {/* Avatar */}
          <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            n.type === "challenge"
              ? "bg-purple-500/20 border-purple-500/30 text-purple-400"
              : "bg-amber-500/20 border-amber-500/30 text-amber-400"
          }`}>
            {(p.sender?.username?.[0] ?? "?").toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            {n.type === 'tournament_pick_draft' && (
              <p className="text-sm text-white/80 leading-snug">
                Round {n.payload?.roundNumber} has started.{' '}
                <Link
                  href={`/tournaments/${n.payload?.tournamentId}/${n.payload?.roundId}/pick`}
                  className="font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Pick your draft →
                </Link>
              </p>
            )}

            {n.type === "friend_request" && (
              <>
                <p className="text-sm text-white/80 leading-snug">
                  <Link
                    href={`/profile/${p.sender?.username}`}
                    className="font-semibold hover:text-white transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    {p.sender?.username}
                  </Link>
                  {" "}sent you a friend request
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleFriendAction(p.requestId, n.id, "accept")}
                    disabled={acting === n.id}
                    className="px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                  >
                    {acting === n.id ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => handleFriendAction(p.requestId, n.id, "decline")}
                    disabled={acting === n.id}
                    className="px-3 py-1 rounded-lg border border-white/10 text-white/40 text-xs font-semibold hover:border-white/20 hover:text-white/60 transition-colors disabled:opacity-50"
                  >
                    {acting === n.id ? "…" : "Decline"}
                  </button>
                </div>
              </>
            )}

            {n.type === "challenge" && (
              <>
                <p className="text-sm text-white/80 leading-snug">
                  <Link
                    href={`/profile/${p.sender?.username}`}
                    className="font-semibold hover:text-white transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    {p.sender?.username}
                  </Link>
                  {" "}challenged you to a{" "}
                  <span className={`font-semibold ${
                    p.mode === "royal" ? "text-purple-400" : p.mode === "pauper" ? "text-sky-400" : "text-amber-400"
                  }`}>
                    {p.mode}
                  </span>
                  {" "}game{p.senderDraft?.name ? ` with "${p.senderDraft.name}"` : ""}
                </p>
                <p className="text-[10px] text-white/25 mt-0.5">No ELO impact · casual</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleChallengeAction(p.challengeId, n.id, "accept", p.mode)}
                    disabled={acting === n.id}
                    className="px-3 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 text-xs font-semibold hover:bg-purple-500/25 transition-colors disabled:opacity-50"
                  >
                    {acting === n.id ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => handleChallengeAction(p.challengeId, n.id, "decline")}
                    disabled={acting === n.id}
                    className="px-3 py-1 rounded-lg border border-white/10 text-white/40 text-xs font-semibold hover:border-white/20 hover:text-white/60 transition-colors disabled:opacity-50"
                  >
                    {acting === n.id ? "…" : "Decline"}
                  </button>
                </div>
              </>
            )}

            {/* Token notification — ready for when token architecture is built */}
            {n.type === "token_granted" && (
              <p className="text-sm text-white/80 leading-snug">
                You received a new token:{" "}
                <span className="font-semibold text-amber-400">{p.label ?? "Token"}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150
          ${open ? "text-white bg-white/8" : "text-white/50 hover:text-white hover:bg-white/6"}`}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <div className={`
        absolute top-[calc(100%+8px)] right-0 w-80 z-50
        bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60
        overflow-hidden transition-all duration-150 origin-top-right
        ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}
      `}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-white/40">Notifications</span>
          {notifications.length > 0 && (
            <button
              onClick={handleDismissAll}
              disabled={acting === "all"}
              className="text-[11px] text-white/30 hover:text-white/55 transition-colors disabled:opacity-40"
            >
              {acting === "all" ? "Clearing…" : "Dismiss all"}
            </button>
          )}
        </div>

        {/* Body */}
        {loading ? (
          <div className="px-4 py-6 text-center text-white/30 text-sm">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-white/25 text-sm">No notifications</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notifications.map(renderNotification)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User dropdown ─────────────────────────────────────────────────────────────
function UserDropdown() {
  const { data: session } = useSession();
  const [open, setOpen]   = useState(false);
  const ref               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!session?.user) return null;

  const user     = session.user;
  const initial  = (user.name ?? user.email ?? "?")[0].toUpperCase();
  const username = (user as any).username as string | undefined;

  const items: DropdownItem[] = [
    { type: "link",   label: "Profile",  href: username ? `/profile/${username}` : "/profile" },
    { type: "link",   label: "Settings", href: "/settings", soon: true },
    { type: "divider" },
    { type: "button", label: "Sign out", onClick: () => signOut({ callbackUrl: "/" }), danger: true },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg transition-colors duration-150 group
          ${open ? "bg-white/8" : "hover:bg-white/6"}`}
      >
        <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-xs font-bold flex-shrink-0">
          {initial}
        </div>
        <span className={`text-sm font-medium max-w-[120px] truncate transition-colors
          ${open ? "text-white" : "text-white/70 group-hover:text-white"}`}>
          {user.name ?? user.email}
        </span>
        <ChevronDown className={`text-white/40 flex-shrink-0 transition-transform duration-200
          ${open ? "rotate-180 text-white/60" : ""}`} />
      </button>

      <div className={`
        absolute top-[calc(100%+8px)] right-0 min-w-[210px] z-50
        bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60
        overflow-hidden transition-all duration-150 origin-top-right
        ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}
      `}>
        <div className="px-4 py-3 border-b border-white/8">
          <p className="text-sm font-semibold text-white truncate">{user.name}</p>
          {user.email && <p className="text-xs text-white/40 truncate mt-0.5">{user.email}</p>}
        </div>

        {items.map((item, i) => {
          if (item.type === "divider") return <div key={i} className="h-px bg-white/8 my-1" />;

          const cls = `flex items-center gap-2 w-full px-4 py-2.5 text-sm text-left transition-colors duration-100
            ${item.soon
              ? "text-white/30 cursor-not-allowed"
              : item.danger
                ? "text-red-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
                : "text-white/75 hover:bg-white/6 hover:text-white cursor-pointer"
            }`;

          if (item.type === "link") {
            return item.soon
              ? <div key={i} className={cls}><span>{item.label}</span><SoonPill /></div>
              : <Link key={i} href={item.href} className={cls}>{item.label}</Link>;
          }

          return <button key={i} onClick={item.onClick} className={cls}>{item.label}</button>;
        })}
      </div>
    </div>
  );
}

// ─── Player search ────────────────────────────────────────────────────────────
function PlayerSearch() {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<{ id: number; username: string; image: string | null; eloStandard: number; online: boolean }[]>([]);
  const [open, setOpen]       = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref                   = useRef<HTMLDivElement>(null);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.users ?? []);
          setOpen(true);
        }
      } catch { /* non-fatal */ }
    }, 200);
  };

  const handleSelect = (username: string) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
    window.location.href = `/profile/${username}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={ref} className="relative mr-1">
      <div className={`flex items-center gap-2 px-3 h-8 rounded-lg border transition-all duration-150 ${
        focused
          ? "border-white/20 bg-white/[0.06] w-44"
          : "border-white/8 bg-white/[0.03] w-36 hover:border-white/14 hover:bg-white/[0.05]"
      }`}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="flex-shrink-0 text-white/30">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search player"
          className="bg-transparent text-sm text-white/70 placeholder-white/25 outline-none w-full min-w-0"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus(); }}
            className="flex-shrink-0 text-white/25 hover:text-white/50 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <div className="absolute top-[calc(100%+6px)] right-0 w-56 z-50 bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-hidden">
          {results.map(user => (
            <button
              key={user.id}
              onClick={() => handleSelect(user.username)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/6 transition-colors text-left"
            >
              <div className="relative flex-shrink-0">
                <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-bold">
                  {user.image
                    ? <img src={user.image} alt={user.username} className="w-full h-full rounded-full object-cover" />
                    : user.username[0].toUpperCase()
                  }
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#1a1d2e] ${user.online ? "bg-emerald-400" : "bg-white/20"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/80 truncate">{user.username}</p>
                <p className="text-[11px] text-white/35">{user.eloStandard} ELO</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute top-[calc(100%+6px)] right-0 w-56 z-50 bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60 px-4 py-3">
          <p className="text-sm text-white/30 text-center">No players found</p>
        </div>
      )}
    </div>
  );
}

// ─── Presence ─────────────────────────────────────────────────────────────────
function usePresence(isLoggedIn: boolean) {
  useEffect(() => {
    if (!isLoggedIn) return;
    import("@/app/lib/socket").then(({ getSocket }) => {
      getSocket().then(socket => {
        socket.off("challenge-accepted");
        socket.on("challenge-accepted", ({ gameId }: { gameId: number }) => {
          window.location.href = `/play/game/${gameId}`;
        });
      }).catch(() => {});
    });
  }, [isLoggedIn]);
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
export default function Nav() {
  const { data: session, status } = useSession();
  const isLoggedIn = status === "authenticated";
  const userId = session?.user?.id ? parseInt(session.user.id) : null;

  usePresence(isLoggedIn);

  const playItems: DropdownItem[] = [
    { type: "link", label: "Standard", href: "/play/standard" },
    { type: "link", label: "Pauper",   href: "/play/pauper"   },
    { type: "link", label: "Royal",    href: "/play/royal"    },
  ];

  const draftItems: DropdownItem[] = [
    { type: "link", label: "Standard drafts", href: "/drafts#standard" },
    { type: "link", label: "Pauper drafts",   href: "/drafts#pauper"   },
    { type: "link", label: "Royal drafts",    href: "/drafts#royal"    },
  ];

  return (
    <nav className="sticky top-0 z-40 w-full h-14 bg-[#0f1117]/95 backdrop-blur-md border-b border-white/8">
      <div className="max-w-7xl mx-auto h-full px-4 flex items-center gap-1">

        <Link href="/" className="mr-4 flex items-center gap-2 flex-shrink-0 group">
          <div className="w-7 h-7 grid grid-cols-2 grid-rows-2 gap-0.5 opacity-90 group-hover:opacity-100 transition-opacity">
            <div className="rounded-sm bg-amber-400" />
            <div className="rounded-sm bg-amber-400/30" />
            <div className="rounded-sm bg-amber-400/30" />
            <div className="rounded-sm bg-amber-400" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">
            Draft<span className="text-amber-400">Chess</span>
          </span>
        </Link>

        {isLoggedIn && (
          <>
            <NavDropdown label="Play"   items={playItems}  />
            <NavDropdown label="Drafts" items={draftItems} />
            <Link href="/tournaments" className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white hover:bg-white/6 rounded-lg transition-colors duration-150">
              Tournaments
            </Link>
          </>
        )}

        <div className="flex-1" />

        {isLoggedIn && userId ? (
          <>
            <PlayerSearch />
            <NotificationsBell userId={userId} />
            <UserDropdown />
          </>
        ) : status === "unauthenticated" ? (
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white transition-colors rounded-lg hover:bg-white/6">
              Sign in
            </Link>
            <Link href="/signup" className="px-4 py-2 text-sm font-semibold text-[#0f1117] bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors">
              Sign up
            </Link>
          </div>
        ) : (
          <div className="w-32 h-8 rounded-lg bg-white/5 animate-pulse" />
        )}

      </div>
    </nav>
  );
}
