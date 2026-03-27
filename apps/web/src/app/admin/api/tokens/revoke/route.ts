// apps/web/src/app/admin/api/tokens/revoke/route.ts
// POST — revoke a token from a user
// body: { userId: number, tokenSlug: string }

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/app/lib/admin-auth'
import { revokeToken }               from '@draftchess/token-service'

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { userId, tokenSlug } = body as Record<string, unknown>

  if (!Number.isInteger(userId) || (userId as number) <= 0) {
    return NextResponse.json({ error: 'userId must be a positive integer' }, { status: 400 })
  }
  if (typeof tokenSlug !== 'string' || !tokenSlug.trim()) {
    return NextResponse.json({ error: 'tokenSlug is required' }, { status: 400 })
  }

  try {
    await revokeToken({ userId: userId as number, tokenSlug: tokenSlug.trim() })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
