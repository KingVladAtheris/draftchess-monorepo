// apps/web/src/proxy.ts
//
// Single proxy.ts with two independent auth blocks.
//
// /admin/*        → AdminUser JWT in a session-scoped HttpOnly cookie.
//                   Checked against ADMIN_JWT_SECRET.
//                   Public routes: /admin/login, /admin/api/auth/*
//
// everything else → NextAuth v5 (next-auth's built-in session handling,
//                   checked against AUTH_SECRET).
//
// The two blocks share no state and no secrets.

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify }                 from 'jose'
import { auth }                      from '@/auth'

const ADMIN_COOKIE = 'draftchess-admin'

function getAdminSecret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET
  if (!s) throw new Error('ADMIN_JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

function isAdminPublic(pathname: string): boolean {
  return pathname === '/admin/login' ||
         pathname.startsWith('/admin/api/auth/')
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Admin block ────────────────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (isAdminPublic(pathname)) {
      return NextResponse.next()
    }

    const token = req.cookies.get(ADMIN_COOKIE)?.value

    if (!token) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }

    try {
      await jwtVerify(token, getAdminSecret())
      return NextResponse.next()
    } catch {
      const res = NextResponse.redirect(new URL('/admin/login', req.url))
      res.cookies.set(ADMIN_COOKIE, '', {
        maxAge:   0,
        path:     '/admin',
        httpOnly: true,
        sameSite: 'lax',
      })
      return res
    }
  }

  // ── Player block — NextAuth ────────────────────────────────────────────────
  return (auth as any)(req)
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)',
  ],
}