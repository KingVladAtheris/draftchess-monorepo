// apps/web/src/app/api/friends/request/route.ts
//
// CHANGE: on successful friend request creation, writes a Notification row
// for the receiver and publishes to draftchess:notifications so the bell
// updates live without polling.

import { NextRequest, NextResponse }          from "next/server";
import { auth }                               from "@/auth";
import { prisma }                             from "@draftchess/db";
import { checkCsrf }                          from "@/app/lib/csrf";
import { publishNotification }                from "@/app/lib/redis-publisher";

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const senderId = parseInt(session.user.id);
  const { targetUserId } = await req.json();

  if (!targetUserId || typeof targetUserId !== "number") {
    return NextResponse.json({ error: "Invalid targetUserId" }, { status: 400 });
  }

  if (targetUserId === senderId) {
    return NextResponse.json({ error: "Cannot send request to yourself" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where:  { id: targetUserId },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const alreadyFriends = await prisma.friendRequest.findFirst({
    where: {
      status: "accepted",
      OR: [
        { senderId, receiverId: targetUserId },
        { senderId: targetUserId, receiverId: senderId },
      ],
    },
  });
  if (alreadyFriends) {
    return NextResponse.json({ error: "Already friends" }, { status: 409 });
  }

  const existing = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { senderId, receiverId: targetUserId },
        { senderId: targetUserId, receiverId: senderId },
      ],
    },
  });

  if (existing) {
    if (existing.senderId === targetUserId && existing.status === "pending") {
      const accepted = await prisma.friendRequest.update({
        where: { id: existing.id },
        data:  { status: "accepted" },
      });
      return NextResponse.json({ status: "accepted", requestId: accepted.id });
    }
    return NextResponse.json({ error: "Request already exists" }, { status: 409 });
  }

  // Fetch sender info for the notification payload
  const sender = await prisma.user.findUnique({
    where:  { id: senderId },
    select: { id: true, username: true, image: true },
  });

  const request = await prisma.friendRequest.create({
    data: { senderId, receiverId: targetUserId },
  });

  // Write Notification row for the receiver
  const notification = await prisma.notification.create({
    data: {
      userId:  targetUserId,
      type:    "friend_request",
      payload: {
        requestId: request.id,
        sender:    { id: sender!.id, username: sender!.username, image: sender!.image },
      },
    },
  });

  // Push to receiver's bell live via WebSocket
  await publishNotification(targetUserId, "friend_request", {
    notificationId: notification.id,
    requestId:      request.id,
    sender:         { id: sender!.id, username: sender!.username, image: sender!.image },
    createdAt:      notification.createdAt.toISOString(),
  });

  return NextResponse.json({ status: "pending", requestId: request.id });
}
