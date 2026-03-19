// apps/web/src/app/api/profile/[username]/route.ts
// Public profile endpoint — no auth required.
// Returns everything needed to render the full profile page.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@draftchess/db";
import { auth } from "@/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  const [session, user] = await Promise.all([
    auth(),
    prisma.user.findUnique({
      where: { username },
      select: {
        id:       true,
        username: true,
        name:     true,
        image:    true,
        createdAt: true,

        eloStandard: true,
        eloPauper:   true,
        eloRoyal:    true,

        gamesPlayedStandard: true,
        gamesPlayedPauper:   true,
        gamesPlayedRoyal:    true,

        winsStandard:   true,
        winsPauper:     true,
        winsRoyal:      true,

        lossesStandard: true,
        lossesPauper:   true,
        lossesRoyal:    true,

        drawsStandard:  true,
        drawsPauper:    true,
        drawsRoyal:     true,

        tokens: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: {
            grantedAt: true,
            token: {
              select: { slug: true, label: true, description: true, icon: true, color: true },
            },
          },
          orderBy: { grantedAt: "asc" },
        },

        followers: { select: { followerId: true } },
        following: { select: { followingId: true } },
      },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Recent games — last 20 finished games across all modes
  const games = await prisma.game.findMany({
    where: {
      status: "finished",
      OR: [{ player1Id: user.id }, { player2Id: user.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id:        true,
      mode:      true,
      createdAt: true,
      winnerId:  true,
      endReason: true,
      eloChange: true,
      player1Id: true,
      player2Id: true,
      player1EloAfter: true,
      player2EloAfter: true,
      player1EloBefore: true,
      player2EloBefore: true,
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
    },
  });

  // ELO history — all finished games sorted ascending for graph
  const eloHistory = await prisma.game.findMany({
    where: {
      status: "finished",
      OR: [{ player1Id: user.id }, { player2Id: user.id }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id:               true,
      mode:             true,
      createdAt:        true,
      player1Id:        true,
      player1EloAfter:  true,
      player2EloAfter:  true,
    },
  });

  // Shape ELO history into per-mode arrays of { date, elo }
  const eloPoints = {
    standard: [] as { date: string; elo: number }[],
    pauper:   [] as { date: string; elo: number }[],
    royal:    [] as { date: string; elo: number }[],
  };

  for (const g of eloHistory) {
    const elo = g.player1Id === user.id ? g.player1EloAfter : g.player2EloAfter;
    if (elo === null) continue;
    const point = { date: g.createdAt.toISOString(), elo };
    if (g.mode === "standard") eloPoints.standard.push(point);
    else if (g.mode === "pauper") eloPoints.pauper.push(point);
    else if (g.mode === "royal")  eloPoints.royal.push(point);
  }

  const viewerId   = session?.user?.id ? parseInt(session.user.id) : null;
  const isOwnProfile = viewerId === user.id;
  const isFollowing  = viewerId ? user.followers.some(f => f.followerId === viewerId) : false;
  const followerCount = user.followers.length;
  const followingCount = user.following.length;

  return NextResponse.json({
    user: {
      id:        user.id,
      username:  user.username,
      name:      user.name,
      image:     user.image,
      createdAt: user.createdAt,
      elo: {
        standard: user.eloStandard,
        pauper:   user.eloPauper,
        royal:    user.eloRoyal,
      },
      stats: {
        standard: { played: user.gamesPlayedStandard, wins: user.winsStandard, losses: user.lossesStandard, draws: user.drawsStandard },
        pauper:   { played: user.gamesPlayedPauper,   wins: user.winsPauper,   losses: user.lossesPauper,   draws: user.drawsPauper   },
        royal:    { played: user.gamesPlayedRoyal,    wins: user.winsRoyal,    losses: user.lossesRoyal,    draws: user.drawsRoyal    },
      },
      tokens: user.tokens.map(t => ({
        slug:        t.token.slug,
        label:       t.token.label,
        description: t.token.description,
        icon:        t.token.icon,
        color:       t.token.color,
        grantedAt:   t.grantedAt,
      })),
      followerCount,
      followingCount,
    },
    games: games.map(g => {
      const isP1        = g.player1Id === user.id;
      const opponent    = isP1 ? g.player2 : g.player1;
      const eloBefore   = isP1 ? g.player1EloBefore : g.player2EloBefore;
      const eloAfter    = isP1 ? g.player1EloAfter  : g.player2EloAfter;
      const result      = g.winnerId === null ? "draw" : g.winnerId === user.id ? "win" : "loss";
      return {
        id:        g.id,
        mode:      g.mode,
        createdAt: g.createdAt,
        result,
        endReason:  g.endReason,
        opponent:   opponent,
        eloBefore,
        eloAfter,
        eloChange:  eloAfter !== null && eloBefore !== null ? eloAfter - eloBefore : null,
      };
    }),
    eloHistory: eloPoints,
    isOwnProfile,
    isFollowing,
    viewerId,
  });
}
