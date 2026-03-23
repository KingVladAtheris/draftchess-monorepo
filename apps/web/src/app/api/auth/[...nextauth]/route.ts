// apps/web/src/app/api/auth/[...nextauth]/route.ts
//
// CHANGE: Wraps NextAuth POST with fail-closed login rate limiting.
// GET (session fetch, CSRF token) is not rate-limited.
// The loginLimiter is keyed by IP since the user isn't authenticated yet.

import { handlers }                  from "@/auth";
import { NextRequest } from "next/server";
import { consumeAuth, loginLimiter } from "@/app/lib/rate-limit";
import { logger }                    from "@draftchess/logger";

const log = logger.child({ module: "web:auth-route" });

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/credentials")) {
    const limited = await consumeAuth(loginLimiter, request);
    if (limited) {
      log.warn({ path: url.pathname }, "login rate limit hit");
      return limited;
    }
  }

  return handlers.POST(request);
}