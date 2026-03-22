// apps/web/src/app/api/notifications/route.ts
//
// GET  — returns all non-dismissed notifications for the current user,
//        sorted newest first. Used for initial bell hydration on page load.
//
// PUT  — marks all notifications as read (resets unread count).
//        Called when the bell is opened.
//
// CHANGE: notifications now come from the Notification table only.
// Friend requests and challenges that previously came from their own
// tables are now written to Notification rows at creation time.
// The GET no longer queries FriendRequest or GameChallenge directly.

import { NextRequest, NextResponse } from "next/server";
import { auth }    from "@/auth";
import { prisma }  from "@draftchess/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ notifications: [] });
  }

  const userId = parseInt(session.user.id);

  const notifications = await prisma.notification.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return NextResponse.json({ notifications, unreadCount });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  await prisma.notification.updateMany({
    where: { userId, read: false },
    data:  { read: true },
  });

  return NextResponse.json({ success: true });
}
