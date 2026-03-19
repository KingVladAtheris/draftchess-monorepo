// apps/web/src/app/lib/csrf.ts
//
// Lightweight CSRF protection for cookie-authenticated POST routes.
//
// Strategy: "custom request header" pattern.
//   - Browsers cannot set custom headers on cross-origin requests without CORS preflight.
//   - We require `X-DraftChess-CSRF: 1` on all state-mutating API routes that rely
//     on cookie auth (everything except /api/notify/match which uses Bearer token).
//   - The client sends this header on every fetch. An attacker-controlled page
//     cannot set it cross-origin, so a forged request is rejected.
//
// This is intentionally simpler than double-submit cookie or synchronizer token:
//   - No token storage, no expiry, no state.
//   - Works correctly with the existing JWT session strategy.
//   - Safe because we already enforce SameSite=Lax on the session cookie via NextAuth.
//
// Usage in a route:
//   const csrfError = checkCsrf(request);
//   if (csrfError) return csrfError;

import { NextRequest, NextResponse } from "next/server";

const CSRF_HEADER = "x-draftchess-csrf";

export function checkCsrf(request: NextRequest): NextResponse | null {
  const header = request.headers.get(CSRF_HEADER);
  if (header === "1") return null; // valid
  return NextResponse.json(
    { error: "Forbidden: missing CSRF header" },
    { status: 403 }
  );
}
