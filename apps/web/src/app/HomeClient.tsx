// apps/web/src/app/HomeClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type User = { name?: string | null; email?: string | null } | null;

// ─── Animated board background ───────────────────────────────────────────────
// 8×8 grid of cells, random cells light up as ghost pieces cycle in/out.
// Pure CSS animation via inline style delays — no canvas, no library.
const PIECES = ["♙", "♘", "♗", "♖", "♕", "♔"];
const TOTAL_CELLS = 64;

function BoardBackground() {
  const [cells, setCells] = useState<{ piece: string; lit: boolean }[]>([]);

  useEffect(() => {
    // Seed initial state
    const initial = Array.from({ length: TOTAL_CELLS }, () => ({
      piece: PIECES[Math.floor(Math.random() * PIECES.length)],
      lit:   Math.random() < 0.18,
    }));
    setCells(initial);

    // Randomly toggle cells every ~1.2s
    const interval = setInterval(() => {
      setCells(prev => {
        const next = [...prev];
        // Toggle 2-4 random cells per tick
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const idx = Math.floor(Math.random() * TOTAL_CELLS);
          next[idx] = {
            piece: PIECES[Math.floor(Math.random() * PIECES.length)],
            lit:   !next[idx].lit,
          };
        }
        return next;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none select-none"
      style={{ maskImage: "radial-gradient(ellipse 80% 80% at 70% 50%, black 30%, transparent 75%)" }}
    >
      <div
        className="absolute right-[-40px] top-1/2 -translate-y-1/2 grid gap-0"
        style={{
          gridTemplateColumns: "repeat(8, 1fr)",
          width: "min(52vw, 540px)",
          aspectRatio: "1",
          opacity: 0.18,
        }}
      >
        {cells.map((cell, i) => {
          const isLight = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
          return (
            <div
              key={i}
              className={`flex items-center justify-center transition-all duration-700 ${
                isLight ? "bg-white/5" : "bg-transparent"
              }`}
              style={{ aspectRatio: "1" }}
            >
              <span
                className="text-amber-300 transition-all duration-700"
                style={{
                  fontSize: "min(5vw, 42px)",
                  opacity: cell.lit ? 0.85 : 0,
                  transform: cell.lit ? "scale(1)" : "scale(0.6)",
                }}
              >
                {cell.piece}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step card ───────────────────────────────────────────────────────────────
function StepCard({
  number,
  icon,
  title,
  description,
  delay,
}: {
  number: number;
  icon: string;
  title: string;
  description: string;
  delay: string;
}) {
  return (
    <div
      className="relative flex flex-col gap-3 p-6 rounded-2xl border border-white/8 bg-white/[0.03] backdrop-blur-sm"
      style={{
        animation: `fadeSlideUp 0.6s ease both`,
        animationDelay: delay,
      }}
    >
      {/* Step number — top right corner */}
      <span className="absolute top-4 right-5 text-xs font-bold text-white/15 tabular-nums">
        0{number}
      </span>

      {/* Icon */}
      <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-2xl">
        {icon}
      </div>

      <div>
        <h3 className="font-display font-700 text-white text-base mb-1">{title}</h3>
        <p className="text-sm text-white/50 leading-relaxed">{description}</p>
      </div>

      {/* Connector arrow — shown on all but last */}
      {number < 3 && (
        <div className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 z-10 text-white/20 text-lg">
          →
        </div>
      )}
    </div>
  );
}

// ─── Stat badge ──────────────────────────────────────────────────────────────
function StatBadge({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-2xl font-bold text-amber-400 font-display">{value}</span>
      <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ─── Home ────────────────────────────────────────────────────────────────────
export default function HomeClient({ user }: { user: User }) {
  return (
    <>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .font-display { font-family: var(--font-display, 'Outfit', sans-serif); }
      `}</style>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[calc(100vh-56px)] flex flex-col justify-center overflow-hidden">

        {/* Subtle radial glow behind headline */}
        <div
          aria-hidden
          className="absolute left-[-10%] top-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(240,165,0,0.06) 0%, transparent 70%)" }}
        />

        <BoardBackground />

        <div className="relative z-10 max-w-7xl mx-auto w-full px-6 md:px-10 py-20">
          <div className="max-w-2xl">

            {/* Eyebrow */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/25 bg-amber-500/8 mb-8 text-xs font-semibold text-amber-400 tracking-widest uppercase"
              style={{ animation: "fadeIn 0.5s ease both", animationDelay: "0.1s" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Chess, reinvented
            </div>

            {/* Headline */}
            <h1
              className="font-display text-5xl md:text-6xl lg:text-7xl font-800 leading-[1.05] tracking-tight text-white mb-6"
              style={{ animation: "fadeSlideUp 0.6s ease both", animationDelay: "0.15s" }}
            >
              Build your army.
              <br />
              <span className="text-amber-400">Outwit</span> your opponent.
            </h1>

            {/* Subheadline */}
            <p
              className="text-lg md:text-xl text-white/55 leading-relaxed mb-10 max-w-xl"
              style={{ animation: "fadeSlideUp 0.6s ease both", animationDelay: "0.25s" }}
            >
              Draft your forces. Bolster them with secret auxiliaries. Do battle!
            </p>

            {/* CTA */}
            <div
              className="flex items-center gap-4"
              style={{ animation: "fadeSlideUp 0.6s ease both", animationDelay: "0.35s" }}
            >
              {user ? (
                <>
                  <Link
                    href="/play/select"
                    className="inline-flex items-center gap-2.5 px-8 py-4 bg-amber-400 hover:bg-amber-300 text-[#0f1117] font-display font-700 text-base rounded-xl transition-all duration-150 active:scale-[0.98] shadow-lg shadow-amber-500/20"
                  >
                    Play Now
                    <span className="text-lg">→</span>
                  </Link>
                  <Link
                    href="/drafts"
                    className="inline-flex items-center gap-2 px-6 py-4 border border-white/12 hover:border-white/25 hover:bg-white/5 text-white/70 hover:text-white font-display font-600 text-base rounded-xl transition-all duration-150"
                  >
                    My Drafts
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-2.5 px-8 py-4 bg-amber-400 hover:bg-amber-300 text-[#0f1117] font-display font-700 text-base rounded-xl transition-all duration-150 active:scale-[0.98] shadow-lg shadow-amber-500/20"
                  >
                    Play for free
                    <span className="text-lg">→</span>
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 px-6 py-4 border border-white/12 hover:border-white/25 hover:bg-white/5 text-white/70 hover:text-white font-display font-600 text-base rounded-xl transition-all duration-150"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bottom fade into next section */}
        <div
          aria-hidden
          className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
          style={{ background: "linear-gradient(to bottom, transparent, #0f1117)" }}
        />
      </section>

      {/* ── Game loop ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 md:px-10 pb-24">

        {/* Section label */}
        <p
          className="text-xs font-bold tracking-widest uppercase text-white/30 mb-8"
          style={{ animation: "fadeIn 0.6s ease both", animationDelay: "0.5s" }}
        >
          How it works
        </p>

        <div className="grid md:grid-cols-3 gap-4 relative">
          <StepCard
            number={1}
            icon="♟"
            title="Draft your army"
            description="Spend 33 points to build a custom piece set. Pawns cost 1, knights and bishops 3, rooks 5. Every draft is a strategic decision."
            delay="0.55s"
          />
          <StepCard
            number={2}
            icon="⚔"
            title="Place your pieces"
            description="Before the game begins, secretly position your extra pieces on your two home ranks. Your opponent can't see where they go."
            delay="0.65s"
          />
          <StepCard
            number={3}
            icon="♔"
            title="Play chess"
            description="Standard chess rules apply — minus castling and en passant. A 30-second move timer keeps games sharp. Use your timebank wisely."
            delay="0.75s"
          />
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <section
        className="border-t border-white/6 py-10"
        style={{ animation: "fadeIn 0.6s ease both", animationDelay: "0.9s" }}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex flex-wrap justify-center gap-12 md:gap-20">
          <StatBadge value="33"  label="Points per draft"  />
          <StatBadge value="30s" label="Move time limit"   />
          <StatBadge value="60s" label="Timebank per game" />
          <StatBadge value="∞"   label="Possible armies"   />
        </div>
      </section>
    </>
  );
}
