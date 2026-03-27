// apps/web/src/app/admin/api/auth/login/route.ts

import { NextRequest, NextResponse }      from 'next/server'
import { prisma }                         from '@draftchess/db'
import bcrypt                             from 'bcrypt'
import { signAdminToken, setAdminCookie } from '@/app/lib/admin-auth'

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { username, password } = body as Record<string, unknown>

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const admin = await prisma.adminUser.findUnique({ where: { username: username.trim() } })

  // Always run bcrypt even when admin not found — prevents timing-based username enumeration
  const hashToCompare = admin?.passwordHash ?? '$2b$10$abcdefghijklmnopqrstuuVGvMoWzaVijUoVcM8dVf2.8VeWjHF3i'
  const valid         = await bcrypt.compare(password, hashToCompare)

  if (!admin || !valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await signAdminToken({ adminId: admin.id, username: admin.username })
  const res   = NextResponse.json({ success: true })
  setAdminCookie(res, token)
  return res
}
