// apps/web/src/app/api/queue/leave/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  await prisma.user.update({
    where: { id: userId },
    data: {
      queueStatus:   "offline",
      queuedAt:      null,
      queuedDraftId: null,
    },
  });

  return NextResponse.json({ success: true });
}
