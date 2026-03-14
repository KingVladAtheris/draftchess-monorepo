// app/api/queue/status/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      queueStatus: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Find the most recent game where user is a participant and game is active
  const currentGame = await prisma.game.findFirst({
    where: {
      OR: [
        { player1Id: userId },
        { player2Id: userId },
      ],
      status: { in: ["prep", "active"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const isMatched = user.queueStatus === "in_game" && currentGame != null;

  return NextResponse.json({
    matched: isMatched,
    gameId: isMatched ? currentGame.id : null,
    status: user.queueStatus,
  });
}
