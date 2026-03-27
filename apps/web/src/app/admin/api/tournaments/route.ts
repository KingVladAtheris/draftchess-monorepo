// apps/web/src/app/admin/api/tournaments/route.ts
// GET  — list all tournaments
// POST — create tournament with stages and prizes

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@draftchess/db'
import { requireAdmin }              from '@/app/lib/admin-auth'

export async function GET() {
  const session = await requireAdmin()
  if (session instanceof NextResponse) return session

  const tournaments = await prisma.tournament.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      stages:  { orderBy: { stageNumber: 'asc' } },
      prizes:  true,
      _count:  { select: { players: true } },
    },
  })

  return NextResponse.json({ tournaments })
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

  if (typeof b.name !== 'string' || !b.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Validate requiredTokenSlug if provided
  if (typeof b.requiredTokenSlug === 'string' && b.requiredTokenSlug) {
    const def = await prisma.tokenDefinition.findUnique({ where: { slug: b.requiredTokenSlug } })
    if (!def) {
      return NextResponse.json({ error: `Token "${b.requiredTokenSlug}" does not exist` }, { status: 400 })
    }
  }

  // Validate prize token slugs
  const prizes = Array.isArray(b.prizes) ? b.prizes : []
  for (const prize of prizes) {
    if (prize.prizeType === 'token' && prize.tokenSlug) {
      const def = await prisma.tokenDefinition.findUnique({ where: { slug: prize.tokenSlug } })
      if (!def) {
        return NextResponse.json({ error: `Prize token "${prize.tokenSlug}" does not exist` }, { status: 400 })
      }
    }
  }

  const stages = Array.isArray(b.stages) ? b.stages : []

  const tournament = await prisma.tournament.create({
    data: {
      name:              b.name.trim(),
      description:       typeof b.description === 'string' ? b.description : null,
      mode:              (b.mode   as any) ?? 'standard',
      format:            (b.format as any) ?? 'single_elimination',
      status:            'upcoming',
      registrationEndsAt: typeof b.registrationEndsAt === 'string' && b.registrationEndsAt
        ? new Date(b.registrationEndsAt) : null,
      startsAt:           typeof b.startsAt === 'string' && b.startsAt
        ? new Date(b.startsAt) : null,
      maxPlayers:        typeof b.maxPlayers === 'number' ? b.maxPlayers : null,
      minPlayers:        typeof b.minPlayers === 'number' ? b.minPlayers : 2,
      requiredTokenSlug: typeof b.requiredTokenSlug === 'string' && b.requiredTokenSlug
        ? b.requiredTokenSlug : null,

      stages: stages.length ? {
        create: stages.map((s: any, i: number) => ({
          stageNumber:         i + 1,
          name:                typeof s.name === 'string' && s.name ? s.name : null,
          format:              s.format,
          advanceCount:        typeof s.advanceCount === 'number' ? s.advanceCount : null,
          startTimeType:       s.startTimeType ?? 'fixed',
          fixedStartAt:        typeof s.fixedStartAt === 'string' && s.fixedStartAt
            ? new Date(s.fixedStartAt) : null,
          relativeBreakMinutes: typeof s.relativeBreakMinutes === 'number'
            ? s.relativeBreakMinutes : null,
          totalRounds:         typeof s.totalRounds === 'number' ? s.totalRounds : null,
        })),
      } : undefined,

      prizes: prizes.length ? {
        create: prizes.map((p: any) => ({
          rankFrom:    p.rankFrom,
          rankTo:      p.rankTo,
          prizeType:   p.prizeType   ?? 'token',
          tokenSlug:   p.tokenSlug   ?? null,
          description: p.description ?? null,
        })),
      } : undefined,
    },
    include: { stages: true, prizes: true },
  })

  return NextResponse.json({ tournament }, { status: 201 })
}
