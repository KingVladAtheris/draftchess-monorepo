// apps/web/src/app/api/following/route.ts
// GET — returns users the current user is following, with online status.

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

  const following = await prisma.userFollow.findMany({
    where: { followerId: userId },
    select: {
      following: {
        select: { id: true, username: true, image: true, eloStandard: true, eloPauper: true, eloRoyal: true },
      },
    },
  });

  const users   = following.map(f => f.following);
  const userIds = users.map(u => u.id);
  const onlineIds = await getOnlineUserIds(userIds);

  return NextResponse.json({
    following: users.map(u => ({ ...u, online: onlineIds.has(u.id) })),
  });
}