// apps/web/src/app/api/notifications/[id]/dismiss/route.ts
//
// POST — permanently delete a single notification.
// Hard delete: dismissed notifications are gone, no cleanup needed.

import { NextRequest, NextResponse } from "next/server";
import { auth }   from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId         = parseInt(session.user.id);
  const { id }         = await params;
  const notificationId = parseInt(id);

  // deleteMany with userId guard — safe no-op if already deleted or not owned
  await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });

  return NextResponse.json({ success: true });
}
