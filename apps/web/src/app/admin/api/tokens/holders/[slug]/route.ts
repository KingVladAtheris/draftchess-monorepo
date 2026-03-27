// apps/web/src/app/admin/api/tokens/holders/[slug]/route.ts
// GET — all holders of a specific token type

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@draftchess/db'
import { requireAdmin }              from '@/app/lib/admin-auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  const { slug } = await params

  const definition = await prisma.tokenDefinition.findUnique({ where: { slug } })
  if (!definition) return NextResponse.json({ error: 'Token not found' }, { status: 404 })

  const holders = await prisma.userToken.findMany({
    where:   { tokenId: definition.id },
    include: { user: { select: { id: true, username: true, email: true } } },
    orderBy: { grantedAt: 'desc' },
  })

  return NextResponse.json({ holders })
}
