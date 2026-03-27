// apps/web/src/app/admin/api/auth/logout/route.ts

import { NextResponse }     from 'next/server'
import { clearAdminCookie } from '@/app/lib/admin-auth'

export async function POST() {
  const res = NextResponse.json({ success: true })
  clearAdminCookie(res)
  return res
}
