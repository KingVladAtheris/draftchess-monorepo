// apps/web/src/app/profile/[username]/page.tsx
//
// CHANGE: queries for an active/prep game for the viewed user.
// Passes liveGame prop to ProfileClient so it can render
// the "Playing right now" section.

import { notFound }  from "next/navigation";
import { prisma }    from "@draftchess/db";
import { auth }      from "@/auth";
import ProfileClient from "./ProfileClient";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return { title: `${username} — DraftChess` };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const session      = await auth();
  const viewerId     = session?.user?.id ? parseInt(session.user.id) : null;

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true, username: true, name: true, image: true, createdAt: true,
      eloStandard: true, eloPauper: true, eloRoyal: true,
      gamesPlayedStandard: true, gamesPlayedPauper: true, gamesPlayedRoyal: true,
      winsStandard: true, winsPauper: true, winsRoyal: true,
      lossesStandard: true, lossesPauper: true, lossesRoyal: true,
      drawsStandard: true, drawsPauper: true, drawsRoyal: true,
      tokens: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: {
          grantedAt: true,
          token: { select: { slug: true, label: true, description: true, icon: true, color: true } },
        },
        orderBy: { grantedAt: "asc" },
      },
      followers: { select: { followerId: true } },
      following:  { select: { followingId: true } },
    },
  });

  if (!user) notFound();

  // ── Live game ──────────────────────────────────────────────────────────────
  const liveGameRaw = await prisma.game.findFirst({
    where: {
      status: { in: ["active", "prep"] },
      OR:     [{ player1Id: user.id }, { player2Id: user.id }],
    },
    select: {
      id:            true,
      status:        true,
      mode:          true,
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
    },
  });

  const liveGame = liveGameRaw
    ? {
        id:      liveGameRaw.id,
        status:  liveGameRaw.status,
        mode:    liveGameRaw.mode ?? "standard",
        player1: liveGameRaw.player1,
        player2: liveGameRaw.player2,
      }
    : null;

  // ── Recent games ───────────────────────────────────────────────────────────
  const games = await prisma.game.findMany({
    where:   { status: "finished", OR: [{ player1Id: user.id }, { player2Id: user.id }] },
    orderBy: { createdAt: "desc" },
    take:    50,
    select: {
      id: true, mode: true, createdAt: true, winnerId: true,
      endReason: true, eloChange: true,
      player1Id: true, player2Id: true,
      player1EloBefore: true, player2EloBefore: true,
      player1EloAfter:  true, player2EloAfter:  true,
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
    },
  });

  const eloHistory = await prisma.game.findMany({
    where:   { status: "finished", OR: [{ player1Id: user.id }, { player2Id: user.id }] },
    orderBy: { createdAt: "asc" },
    select:  { id: true, mode: true, createdAt: true, player1Id: true, player1EloAfter: true, player2EloAfter: true },
  });

  const eloPoints = {
    standard: [] as { date: string; elo: number }[],
    pauper:   [] as { date: string; elo: number }[],
    royal:    [] as { date: string; elo: number }[],
  };
  for (const g of eloHistory) {
    const elo = g.player1Id === user.id ? g.player1EloAfter : g.player2EloAfter;
    if (elo === null) continue;
    const point = { date: g.createdAt.toISOString(), elo };
    if      (g.mode === "standard") eloPoints.standard.push(point);
    else if (g.mode === "pauper")   eloPoints.pauper.push(point);
    else if (g.mode === "royal")    eloPoints.royal.push(point);
  }

  const shapedGames = games.map(g => {
    const isP1      = g.player1Id === user.id;
    const opponent  = isP1 ? g.player2 : g.player1;
    const eloBefore = isP1 ? g.player1EloBefore : g.player2EloBefore;
    const eloAfter  = isP1 ? g.player1EloAfter  : g.player2EloAfter;
    return {
      id:        g.id,
      mode:      g.mode,
      createdAt: g.createdAt.toISOString(),
      result:    g.winnerId === null ? "draw" as const : g.winnerId === user.id ? "win" as const : "loss" as const,
      endReason: g.endReason,
      opponent,
      eloBefore,
      eloAfter,
      eloChange: eloAfter !== null && eloBefore !== null ? eloAfter - eloBefore : null,
    };
  });

  const isOwnProfile = viewerId === user.id;
  const isFollowing  = viewerId ? user.followers.some(f => f.followerId === viewerId) : false;

  let friendStatus: "none" | "pending_sent" | "pending_received" | "friends" = "none";
  let friendRequestId: number | null = null;

  if (viewerId && !isOwnProfile) {
    const friendRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: viewerId, receiverId: user.id },
          { senderId: user.id, receiverId: viewerId },
        ],
      },
      select: { id: true, senderId: true, status: true },
    });
    if (friendRequest) {
      friendRequestId = friendRequest.id;
      if      (friendRequest.status === "accepted")                       friendStatus = "friends";
      else if (friendRequest.senderId === viewerId)                       friendStatus = "pending_sent";
      else                                                                friendStatus = "pending_received";
    }
  }

  const profileData = {
    id:        user.id,
    username:  user.username,
    name:      user.name,
    image:     user.image,
    createdAt: user.createdAt.toISOString(),
    elo: { standard: user.eloStandard, pauper: user.eloPauper, royal: user.eloRoyal },
    stats: {
      standard: { played: user.gamesPlayedStandard, wins: user.winsStandard, losses: user.lossesStandard, draws: user.drawsStandard },
      pauper:   { played: user.gamesPlayedPauper,   wins: user.winsPauper,   losses: user.lossesPauper,   draws: user.drawsPauper   },
      royal:    { played: user.gamesPlayedRoyal,    wins: user.winsRoyal,    losses: user.lossesRoyal,    draws: user.drawsRoyal    },
    },
    tokens: user.tokens.map(t => ({
      slug: t.token.slug, label: t.token.label,
      description: t.token.description, icon: t.token.icon,
      color: t.token.color, grantedAt: t.grantedAt.toISOString(),
    })),
    followerCount:  user.followers.length,
    followingCount: user.following.length,
  };

  return (
    <ProfileClient
      profile={profileData}
      games={shapedGames}
      eloHistory={eloPoints}
      liveGame={liveGame}
      isOwnProfile={isOwnProfile}
      isFollowing={isFollowing}
      friendStatus={friendStatus}
      friendRequestId={friendRequestId}
      viewerId={viewerId}
    />
  );
}
