// apps/web/src/components/ToastProvider.tsx
// Lightweight toast system. No external dependency.
// Provides useToast() hook; wrap the layout with <ToastProvider>.
//
// Usage:
//   const toast = useToast();
//   toast.error("Illegal move");
//   toast.success("Draft saved");
//   toast.warn("Connection lost");
//   toast.info("Opponent reconnected");
"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";

type ToastKind = "success" | "error" | "warn" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  dying: boolean;
};

type ToastAPI = {
  success: (msg: string) => void;
  error:   (msg: string) => void;
  warn:    (msg: string) => void;
  info:    (msg: string) => void;
};

const ToastContext = createContext<ToastAPI>({
  success: () => {}, error: () => {}, warn: () => {}, info: () => {},
});

const DURATION    = 3800; // ms before starting fade
const FADE_DELAY  = 300;  // ms fade-out animation

let _counter = 0;

const KIND_STYLES: Record<ToastKind, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  error:   "border-red-500/40    bg-red-500/10    text-red-400",
  warn:    "border-amber-500/40  bg-amber-500/10  text-amber-400",
  info:    "border-white/15      bg-white/5       text-white/70",
};

const KIND_ICONS: Record<ToastKind, string> = {
  success: "✓", error: "✕", warn: "⚠", info: "ℹ",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    // Start fade
    setToasts(prev => prev.map(t => t.id === id ? { ...t, dying: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, FADE_DELAY);
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++_counter;
    setToasts(prev => [...prev.slice(-4), { id, kind, message, dying: false }]);
    const timer = setTimeout(() => dismiss(id), DURATION);
    timers.current.set(id, timer);
  }, [dismiss]);

  const api: ToastAPI = {
    success: (m) => push("success", m),
    error:   (m) => push("error",   m),
    warn:    (m) => push("warn",    m),
    info:    (m) => push("info",    m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toast container — fixed bottom-right */}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border
              shadow-xl shadow-black/40 text-sm font-display font-500 max-w-sm
              cursor-pointer select-none
              transition-all duration-300
              ${KIND_STYLES[t.kind]}
              ${t.dying ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"}
            `}
            style={{ animation: t.dying ? undefined : "toastIn 0.25s ease both" }}
          >
            <span className="text-base leading-none flex-shrink-0">{KIND_ICONS[t.kind]}</span>
            <span className="leading-snug">{t.message}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)  scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastAPI {
  return useContext(ToastContext);
}
