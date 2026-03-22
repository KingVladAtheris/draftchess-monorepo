// apps/web/src/app/api/notifications/dismiss-all/route.ts
//
// POST — permanently delete all notifications for the current user.

import { NextRequest, NextResponse } from "next/server";
import { auth }   from "@/auth";
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

  await prisma.notification.deleteMany({ where: { userId } });

  return NextResponse.json({ success: true });
}
