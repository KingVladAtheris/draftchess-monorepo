// apps/web/src/app/admin/api/tokens/[slug]/route.ts
// GET   — single token definition + all holders
// PATCH — edit token definition fields

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

  const token = await prisma.tokenDefinition.findUnique({
    where:   { slug },
    include: {
      holders: {
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: { grantedAt: 'desc' },
      },
    },
  })

  if (!token) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  return NextResponse.json({ token })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  const { slug } = await params

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  try {
    const token = await prisma.tokenDefinition.update({
      where: { slug },
      data: {
        ...(typeof b.label           === 'string'  ? { label:           b.label.trim()      } : {}),
        ...(typeof b.description     === 'string'  ? { description:     b.description       } : {}),
        ...(b.description === null                 ? { description:     null                } : {}),
        ...(typeof b.icon            === 'string'  ? { icon:            b.icon              } : {}),
        ...(b.icon === null                        ? { icon:            null                } : {}),
        ...(typeof b.color           === 'string'  ? { color:           b.color             } : {}),
        ...(b.color === null                       ? { color:           null                } : {}),
        ...(typeof b.grantsPrivilege === 'boolean' ? { grantsPrivilege: b.grantsPrivilege   } : {}),
        ...(typeof b.consumeOnEntry  === 'boolean' ? { consumeOnEntry:  b.consumeOnEntry    } : {}),
        ...(typeof b.durationDays    === 'number'  ? { durationDays:    Math.floor(b.durationDays) } : {}),
        ...(b.durationDays === null                ? { durationDays:    null                } : {}),
      },
    })
    return NextResponse.json({ token })
  } catch (err: any) {
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }
    throw err
  }
}
