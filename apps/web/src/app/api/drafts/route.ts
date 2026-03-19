// apps/web/src/app/api/drafts/route.ts
// GET — returns the current user's drafts, optionally filtered by ?mode=

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const mode   = req.nextUrl.searchParams.get("mode") ?? undefined;

  const drafts = await prisma.draft.findMany({
    where: {
      userId,
      ...(mode ? { mode: mode as any } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, mode: true, points: true, updatedAt: true },
  });

  return NextResponse.json({ drafts });
}
