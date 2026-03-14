// src/components/Nav.tsx
// Top navigation bar for Draft Chess.
//
// Uses useSession() from next-auth/react so the nav updates reactively
// when the user signs in or out — no server re-render required.
//
// CHANGES:
//   - Added NotificationsBell with friend request inbox
//   - Fixed Profile link to use username instead of userId
//   - Profile no longer marked soon: true

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { apiFetch } from "@/app/lib/api-fetch";

// ─── Icons ──────────────────────────────────────────────────────────────────
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

const SoonPill = () => (
  <span className="ml-auto text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
    Soon
  </span>
);

// ─── Types ───────────────────────────────────────────────────────────────────
type DropdownItem =
  | { type: "link";   label: string; href: string;        soon?: boolean; danger?: boolean }
  | { type: "button"; label: string; onClick: () => void; soon?: boolean; danger?: boolean }
  | { type: "divider" };

type Notification =
  | {
      id:        string;
      type:      "friend_request";
      requestId: number;
      sender:    { id: number; username: string; image: string | null };
      createdAt: string;
    }
  | {
      id:          string;
      type:        "challenge";
      challengeId: number;
      mode:        string;
      sender:      { id: number; username: string; image: string | null };
      senderDraft: { id: number; name: string | null } | null;
      createdAt:   string;
      expiresAt:   string;
    };

// ─── Shared dropdown panel ───────────────────────────────────────────────────
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

// ─── Generic nav dropdown trigger ────────────────────────────────────────────
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
function NotificationsBell() {
  const [open, setOpen]                   = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading]             = useState(false);
  const [acting, setActing]               = useState<number | null>(null);
  const ref                               = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount + poll every 30s so challenges arrive without manual bell open
  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open) fetchNotifications(); // refresh on open
  };

  const handleFriendAction = async (requestId: number, action: "accept" | "decline") => {
    setActing(requestId);
    try {
      const res = await apiFetch(`/api/friends/${requestId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      });
      if (res.ok) {
        setNotifications(prev => prev.filter(n => !(n.type === "friend_request" && n.requestId === requestId)));
      }
    } finally {
      setActing(null);
    }
  };

  const handleChallengeAction = async (challengeId: number, action: "accept" | "decline") => {
    setActing(challengeId);
    try {
      if (action === "decline") {
        const res = await apiFetch(`/api/challenges/${challengeId}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "decline" }),
        });
        if (res.ok) {
          setNotifications(prev => prev.filter(n => !(n.type === "challenge" && n.challengeId === challengeId)));
        }
        return;
      }
      // Accept — find the notification to get the mode, then send to the
      // select page so the acceptor can pick their draft before the game starts.
      const notif = notifications.find(n => n.type === "challenge" && n.challengeId === challengeId);
      const mode  = notif?.type === "challenge" ? notif.mode : "standard";
      setNotifications(prev => prev.filter(n => !(n.type === "challenge" && n.challengeId === challengeId)));
      window.location.href = `/play/${mode}?challengeId=${challengeId}`;
    } finally {
      setActing(null);
    }
  };

  const count = notifications.length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150
          ${open ? "text-white bg-white/8" : "text-white/50 hover:text-white hover:bg-white/6"}`}
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <div className={`
        absolute top-[calc(100%+8px)] right-0 w-72 z-50
        bg-[#1a1d2e] border border-white/10 rounded-xl shadow-2xl shadow-black/60
        overflow-hidden transition-all duration-150 origin-top-right
        ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}
      `}>
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-white/40">Notifications</span>
          {count > 0 && <span className="text-xs text-white/30">{count} pending</span>}
        </div>

        {loading ? (
          <div className="px-4 py-6 text-center text-white/30 text-sm">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-6 text-center text-white/25 text-sm">No notifications</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map(n => (
              <div key={n.id} className="px-4 py-3 border-b border-white/6 last:border-0">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    n.type === "challenge"
                      ? "bg-purple-500/20 border-purple-500/30 text-purple-400"
                      : "bg-amber-500/20 border-amber-500/30 text-amber-400"
                  }`}>
                    {n.sender.username[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    {n.type === "friend_request" ? (
                      <>
                        <p className="text-sm text-white/80 leading-snug">
                          <Link
                            href={`/profile/${n.sender.username}`}
                            className="font-semibold hover:text-white transition-colors"
                            onClick={() => setOpen(false)}
                          >
                            {n.sender.username}
                          </Link>
                          {" "}sent you a friend request
                        </p>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleFriendAction(n.requestId, "accept")}
                            disabled={acting === n.requestId}
                            className="px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                          >
                            {acting === n.requestId ? "…" : "Accept"}
                          </button>
                          <button
                            onClick={() => handleFriendAction(n.requestId, "decline")}
                            disabled={acting === n.requestId}
                            className="px-3 py-1 rounded-lg border border-white/10 text-white/40 text-xs font-semibold hover:border-white/20 hover:text-white/60 transition-colors disabled:opacity-50"
                          >
                            {acting === n.requestId ? "…" : "Decline"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-white/80 leading-snug">
                          <Link
                            href={`/profile/${n.sender.username}`}
                            className="font-semibold hover:text-white transition-colors"
                            onClick={() => setOpen(false)}
                          >
                            {n.sender.username}
                          </Link>
                          {" "}challenged you to a{" "}
                          <span className={`font-semibold ${
                            n.mode === "royal" ? "text-purple-400" : n.mode === "pauper" ? "text-sky-400" : "text-amber-400"
                          }`}>
                            {n.mode}
                          </span>
                          {" "}game
                          {n.senderDraft?.name ? ` with "${n.senderDraft.name}"` : ""}
                        </p>
                        <p className="text-[10px] text-white/25 mt-0.5">No ELO impact · casual</p>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleChallengeAction(n.challengeId, "accept")}
                            disabled={acting === n.challengeId}
                            className="px-3 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 text-xs font-semibold hover:bg-purple-500/25 transition-colors disabled:opacity-50"
                          >
                            {acting === n.challengeId ? "…" : "Accept"}
                          </button>
                          <button
                            onClick={() => handleChallengeAction(n.challengeId, "decline")}
                            disabled={acting === n.challengeId}
                            className="px-3 py-1 rounded-lg border border-white/10 text-white/40 text-xs font-semibold hover:border-white/20 hover:text-white/60 transition-colors disabled:opacity-50"
                          >
                            {acting === n.challengeId ? "…" : "Decline"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User dropdown ────────────────────────────────────────────────────────────
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
        {/* Identity header */}
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

// ─── Presence ────────────────────────────────────────────────────────────────
// Connects the socket as soon as the user is authenticated so that
// online:{userId} is set in Redis (and the heartbeat keeps it alive) regardless
// of which page the user is on — not just on the play/game pages.
function usePresence(isLoggedIn: boolean) {
  useEffect(() => {
    if (!isLoggedIn) return;
    import("@/app/lib/socket").then(({ getSocket }) => {
      getSocket().then(socket => {
        // Redirect challenger when their challenge gets accepted
        socket.off("challenge-accepted");
        socket.on("challenge-accepted", ({ gameId }: { gameId: number }) => {
          window.location.href = `/play/game/${gameId}`;
        });
      }).catch(() => {}); // connect — heartbeat starts on 'connect' event
    });
  }, [isLoggedIn]);
}

// ─── Nav ─────────────────────────────────────────────────────────────────────
export default function Nav() {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";

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

        {/* Logo */}
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

        {/* Left items */}
        {isLoggedIn && (
          <>
            <NavDropdown label="Play"   items={playItems}  />
            <NavDropdown label="Drafts" items={draftItems} />
            <div className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white/25 cursor-not-allowed select-none">
              Tournaments <SoonPill />
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Right items */}
        {isLoggedIn ? (
          <>
            <div className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white/25 cursor-not-allowed select-none mr-1">
              Leaderboard <SoonPill />
            </div>
            <NotificationsBell />
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
          // status === "loading" — skeleton to prevent layout shift
          <div className="w-32 h-8 rounded-lg bg-white/5 animate-pulse" />
        )}

      </div>
    </nav>
  );
}
