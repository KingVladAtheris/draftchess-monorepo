// apps/web/src/app/api/profile/[username]/following/route.ts
// GET — publicly visible list of users that [username] is following.
// Online status is only included if the viewer is authenticated.

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  const user = await prisma.user.findUnique({
    where:  { username },
    select: { id: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const rows = await prisma.userFollow.findMany({
    where: { followerId: user.id },
    select: {
      following: {
        select: { id: true, username: true, image: true, eloStandard: true, eloPauper: true, eloRoyal: true },
      },
    },
  });

  const users = rows.map(r => r.following);

  // Only include online status if viewer is authenticated
  const session   = await auth();
  const showOnline = !!session?.user?.id;
  const onlineIds  = showOnline ? await getOnlineUserIds(users.map(u => u.id)) : new Set<number>();

  return NextResponse.json({
    following: users.map(u => ({ ...u, online: onlineIds.has(u.id) })),
  });
}