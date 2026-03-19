// apps/web/src/app/api/profile/[username]/follow/route.ts
// POST — follow or unfollow a user. Toggles based on current state.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { username } = await params;
  const followerId = parseInt(session.user.id);

  const target = await prisma.user.findUnique({
    where:  { username },
    select: { id: true },
  });

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.id === followerId) {
    return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
  }

  const existing = await prisma.userFollow.findUnique({
    where: { followerId_followingId: { followerId, followingId: target.id } },
  });

  if (existing) {
    await prisma.userFollow.delete({
      where: { followerId_followingId: { followerId, followingId: target.id } },
    });
    return NextResponse.json({ following: false });
  } else {
    await prisma.userFollow.create({
      data: { followerId, followingId: target.id },
    });
    return NextResponse.json({ following: true });
  }
}
