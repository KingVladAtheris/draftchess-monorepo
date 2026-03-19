// apps/web/src/app/api/friends/[requestId]/route.ts
// PATCH — accept or decline a pending friend request.
// DELETE — remove a friend (sets status back to declined, or deletes entirely).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { checkCsrf } from "@/app/lib/csrf";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId    = parseInt(session.user.id);
  const requestId = parseInt((await params).requestId);
  const { action } = await req.json(); // "accept" | "decline"

  if (!["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.receiverId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (request.status !== "pending") return NextResponse.json({ error: "Request already resolved" }, { status: 409 });

  const updated = await prisma.friendRequest.update({
    where: { id: requestId },
    data:  { status: action === "accept" ? "accepted" : "declined" },
  });

  return NextResponse.json({ status: updated.status });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId    = parseInt(session.user.id);
  const requestId = parseInt((await params).requestId);

  const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Must be one of the two parties
  if (request.senderId !== userId && request.receiverId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.friendRequest.delete({ where: { id: requestId } });
  return NextResponse.json({ removed: true });
}
