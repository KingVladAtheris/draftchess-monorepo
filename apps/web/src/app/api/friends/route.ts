// apps/web/src/app/api/friends/route.ts
// GET — returns current user's friends (accepted requests) and
//        pending incoming requests, with online status from Redis.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { getRedisClient } from "@/app/lib/redis-publisher";

async function getOnlineUserIds(userIds: number[]): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  try {
    const redis   = await getRedisClient();
    const keys    = userIds.map(id => `online:${id}`);
    const results = await redis.mGet(keys);
    const online  = new Set<number>();
    results.forEach((val, i) => { if (val) online.add(userIds[i]); });
    return online;
  } catch {
    return new Set();
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = parseInt(session.user.id);

  const [accepted, pending] = await Promise.all([
    // Accepted friendships in either direction
    prisma.friendRequest.findMany({
      where: {
        status: "accepted",
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      select: {
        id:         true,
        senderId:   true,
        receiverId: true,
        sender:   { select: { id: true, username: true, image: true, eloStandard: true, eloPauper: true, eloRoyal: true } },
        receiver: { select: { id: true, username: true, image: true, eloStandard: true, eloPauper: true, eloRoyal: true } },
      },
    }),
    // Pending incoming requests
    prisma.friendRequest.findMany({
      where: { receiverId: userId, status: "pending" },
      select: {
        id:       true,
        senderId: true,
        createdAt: true,
        sender: { select: { id: true, username: true, image: true } },
      },
    }),
  ]);

  const friends = accepted.map(r => {
    const friend = r.senderId === userId ? r.receiver : r.sender;
    return { requestId: r.id, ...friend };
  });

  const friendIds = friends.map(f => f.id);
  const onlineIds = await getOnlineUserIds(friendIds);

  return NextResponse.json({
    friends: friends.map(f => ({ ...f, online: onlineIds.has(f.id) })),
    pendingIncoming: pending.map(r => ({
      requestId: r.id,
      senderId:  r.senderId,
      sender:    r.sender,
      createdAt: r.createdAt,
    })),
  });
}