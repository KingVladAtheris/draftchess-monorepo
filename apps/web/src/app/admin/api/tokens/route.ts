// apps/web/src/app/admin/api/tokens/route.ts
// GET  — list all TokenDefinition rows with holder counts
// POST — create a new token definition

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@draftchess/db'
import { requireAdmin }              from '@/app/lib/admin-auth'

export async function GET() {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  const tokens = await prisma.tokenDefinition.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { holders: true } } },
  })

  return NextResponse.json({ tokens })
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (typeof b.slug !== 'string' || !b.slug.trim()) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }
  if (typeof b.label !== 'string' || !b.label.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  if (!/^[a-z0-9_-]+$/.test(b.slug.trim())) {
    return NextResponse.json(
      { error: 'slug must only contain lowercase letters, numbers, hyphens, and underscores' },
      { status: 400 },
    )
  }

  try {
    const token = await prisma.tokenDefinition.create({
      data: {
        slug:            b.slug.trim(),
        label:           (b.label as string).trim(),
        description:     typeof b.description    === 'string'  ? b.description    : null,
        icon:            typeof b.icon           === 'string'  ? b.icon           : null,
        color:           typeof b.color          === 'string'  ? b.color          : null,
        grantsPrivilege: b.grantsPrivilege === true,
        isPurchasable:   b.isPurchasable   === true,
        stripePriceId:   typeof b.stripePriceId  === 'string'  ? b.stripePriceId  : null,
        consumeOnEntry:  b.consumeOnEntry  === true,
        durationDays:    typeof b.durationDays   === 'number' && b.durationDays > 0
          ? Math.floor(b.durationDays) : null,
      },
    })
    return NextResponse.json({ token }, { status: 201 })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'A token with this slug already exists' }, { status: 409 })
    }
    throw err
  }
}
