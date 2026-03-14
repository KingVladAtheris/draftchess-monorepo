// src/app/api/friends/request/route.ts
// POST — send a friend request to a user by userId.

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

  const senderId = parseInt(session.user.id);
  const { targetUserId } = await req.json();

  if (!targetUserId || typeof targetUserId !== "number") {
    return NextResponse.json({ error: "Invalid targetUserId" }, { status: 400 });
  }

  if (targetUserId === senderId) {
    return NextResponse.json({ error: "Cannot send request to yourself" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Check if already friends (accepted request in either direction)
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

  // Check if a pending request already exists in either direction
  const existing = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { senderId, receiverId: targetUserId },
        { senderId: targetUserId, receiverId: senderId },
      ],
    },
  });

  if (existing) {
    // If they sent us a request, auto-accept it
    if (existing.senderId === targetUserId && existing.status === "pending") {
      const accepted = await prisma.friendRequest.update({
        where: { id: existing.id },
        data:  { status: "accepted" },
      });
      return NextResponse.json({ status: "accepted", requestId: accepted.id });
    }
    return NextResponse.json({ error: "Request already exists" }, { status: 409 });
  }

  const request = await prisma.friendRequest.create({
    data: { senderId, receiverId: targetUserId },
  });

  return NextResponse.json({ status: "pending", requestId: request.id });
}
