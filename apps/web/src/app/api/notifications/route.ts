// apps/web/src/app/api/notifications/route.ts
// GET — returns pending friend requests AND pending game challenges for the
//        current user, shaped as a generic notifications array.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ notifications: [] });
  }

  const userId = parseInt(session.user.id);
  const now    = new Date();

  const [pendingRequests, pendingChallenges] = await Promise.all([
    prisma.friendRequest.findMany({
      where:   { receiverId: userId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: {
        id:        true,
        createdAt: true,
        sender:    { select: { id: true, username: true, image: true } },
      },
    }),
    prisma.gameChallenge.findMany({
      where:   { receiverId: userId, status: "pending", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: {
        id:           true,
        mode:         true,
        createdAt:    true,
        expiresAt:    true,
        senderDraftId: true,
        sender:       { select: { id: true, username: true, image: true } },
        senderDraft:  { select: { id: true, name: true } },
      },
    }),
  ]);

  const notifications = [
    ...pendingRequests.map(r => ({
      id:        `friend-${r.id}`,
      type:      "friend_request" as const,
      requestId: r.id,
      sender:    r.sender,
      createdAt: r.createdAt.toISOString(),
    })),
    ...pendingChallenges.map(c => ({
      id:          `challenge-${c.id}`,
      type:        "challenge" as const,
      challengeId: c.id,
      mode:        c.mode,
      sender:      c.sender,
      senderDraft: c.senderDraft,
      createdAt:   c.createdAt.toISOString(),
      expiresAt:   c.expiresAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ notifications });
}
