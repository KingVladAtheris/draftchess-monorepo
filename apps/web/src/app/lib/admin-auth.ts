// apps/web/src/app/lib/admin-auth.ts
//
// Admin authentication for the /admin route group inside apps/web.
//
// Cookie: draftchess-admin
//   HttpOnly        — not readable by JS (XSS protection)
//   SameSite=Lax    — CSRF protection without breaking normal navigation
//   Path=/admin     — scoped: never sent to player API routes
//   NO Max-Age      — session-scoped: browser deletes on all-windows-close
//   Secure in prod  — HTTPS only in production
//
// JWT signed with ADMIN_JWT_SECRET (env var, separate from AUTH_SECRET).
// 8-hour hard expiry cap even though cookie is session-scoped.
// Payload: { adminId: number, username: string }

import { SignJWT, jwtVerify } from 'jose'
import { cookies }            from 'next/headers'
import { NextResponse }       from 'next/server'

const COOKIE_NAME = 'draftchess-admin'

function getSecret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET
  if (!s) throw new Error('ADMIN_JWT_SECRET environment variable is not set')
  return new TextEncoder().encode(s)
}

export interface AdminSession {
  adminId:  number
  username: string
}

// ── Token signing ─────────────────────────────────────────────────────────────

export async function signAdminToken(payload: AdminSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret())
}

export async function verifyAdminToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return {
      adminId:  payload.adminId  as number,
      username: payload.username as string,
    }
  } catch {
    return null
  }
}

// ── Server-side session helpers ───────────────────────────────────────────────

/**
 * Read the admin session from the request cookie store.
 * Use in server components and server actions.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyAdminToken(token)
}

/**
 * Guard for API route handlers.
 * Returns the session on success, or a ready-to-return 401 NextResponse.
 *
 * Usage:
 *   const session = await requireAdmin()
 *   if (session instanceof NextResponse) return session
 *   // session.adminId and session.username are available here
 */
export async function requireAdmin(): Promise<AdminSession | NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return session
}

// ── Cookie setters ────────────────────────────────────────────────────────────

export function setAdminCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/admin',
    secure:   process.env.NODE_ENV === 'production',
    // Deliberately NO maxAge / expires → session-scoped cookie.
    // The browser deletes it when all browser windows/tabs are closed.
  })
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/admin',
    maxAge:   0,
  })
}
