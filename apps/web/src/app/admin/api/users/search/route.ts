// apps/web/src/app/admin/api/users/search/route.ts
// GET ?q=prefix — search users by username (for token grant/revoke UI)

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@draftchess/db'
import { requireAdmin }              from '@/app/lib/admin-auth'

export async function GET(req: NextRequest) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ users: [] })

  const users = await prisma.user.findMany({
    where:   { username: { startsWith: q, mode: 'insensitive' } },
    select:  { id: true, username: true, email: true },
    take:    10,
    orderBy: { username: 'asc' },
  })

  return NextResponse.json({ users })
}
