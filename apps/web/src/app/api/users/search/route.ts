// apps/web/src/app/api/users/search/route.ts
//
// GET ?q=prefix — returns up to 8 users whose username starts with q.
// Minimum 2 characters. Uses the existing @@index([username]) on User.
// Online status included via Redis mGet.

import { NextRequest, NextResponse } from "next/server";
import { auth }          from "@/auth";
import { prisma }        from "@draftchess/db";
import { getRedisClient } from "@/app/lib/redis-publisher";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ users: [] });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const users = await prisma.user.findMany({
    where: {
      username: { startsWith: q, mode: "insensitive" },
    },
    select: {
      id:          true,
      username:    true,
      image:       true,
      eloStandard: true,
    },
    take:    8,
    orderBy: { username: "asc" },
  });

  // Online status from Redis
  let onlineIds = new Set<number>();
  try {
    if (users.length > 0) {
      const redis   = await getRedisClient();
      const keys    = users.map(u => `online:${u.id}`);
      const results = await redis.mGet(keys);
      results.forEach((val, i) => { if (val) onlineIds.add(users[i].id); });
    }
  } catch { /* non-fatal — omit online status */ }

  return NextResponse.json({
    users: users.map(u => ({ ...u, online: onlineIds.has(u.id) })),
  });
}