// apps/web/src/app/signup/SignupClient.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function AuthCard({ children, title, subtitle }: {
  children: React.ReactNode; title: string; subtitle: string;
}) {
  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4 py-12">
      <div aria-hidden className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 600px 400px at 50% 40%, rgba(240,165,0,0.04) 0%, transparent 70%)"
      }} />

      <div className="relative w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 grid grid-cols-2 grid-rows-2 gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
              <div className="rounded-sm bg-amber-400" />
              <div className="rounded-sm bg-amber-400/30" />
              <div className="rounded-sm bg-amber-400/30" />
              <div className="rounded-sm bg-amber-400" />
            </div>
            <span className="text-sm font-bold tracking-tight text-white/60 group-hover:text-white transition-colors">
              Draft<span className="text-amber-400">Chess</span>
            </span>
          </Link>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#1a1d2e]/80 backdrop-blur-sm p-8 shadow-2xl shadow-black/50">
          <h1 className="font-display text-2xl font-700 text-white mb-1">{title}</h1>
          <p className="text-sm text-white/45 mb-7">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function SignupClient() {
  const [username, setUsername] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const router                  = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) { setError("Please fill in all fields."); return; }
    if (username.length < 2 || username.length > 32) { setError("Username must be 2–32 characters."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true); setError(null);

    try {
      const res = await fetch("/api/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create account.");
        setLoading(false); return;
      }

      // Auto sign-in after successful registration
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Account created — please sign in.");
        router.push("/login");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Create an account" subtitle="Join and start building your army">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="yourname"
            autoComplete="username"
            maxLength={32}
            className="input"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="input"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
            className="input"
          />
        </div>

        {error && (
          <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-1">
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-center text-sm text-white/35 mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-amber-400 hover:text-amber-300 transition-colors font-medium">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
