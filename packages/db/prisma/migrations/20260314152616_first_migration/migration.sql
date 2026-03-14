-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('standard', 'pauper', 'royal');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('single_elimination', 'swiss', 'round_robin', 'arena');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('upcoming', 'active', 'finished', 'cancelled');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eloStandard" INTEGER NOT NULL DEFAULT 1200,
    "eloPauper" INTEGER NOT NULL DEFAULT 1200,
    "eloRoyal" INTEGER NOT NULL DEFAULT 1200,
    "gamesPlayedStandard" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayedPauper" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayedRoyal" INTEGER NOT NULL DEFAULT 0,
    "winsStandard" INTEGER NOT NULL DEFAULT 0,
    "winsPauper" INTEGER NOT NULL DEFAULT 0,
    "winsRoyal" INTEGER NOT NULL DEFAULT 0,
    "lossesStandard" INTEGER NOT NULL DEFAULT 0,
    "lossesPauper" INTEGER NOT NULL DEFAULT 0,
    "lossesRoyal" INTEGER NOT NULL DEFAULT 0,
    "drawsStandard" INTEGER NOT NULL DEFAULT 0,
    "drawsPauper" INTEGER NOT NULL DEFAULT 0,
    "drawsRoyal" INTEGER NOT NULL DEFAULT 0,
    "queueStatus" TEXT DEFAULT 'offline',
    "queuedAt" TIMESTAMP(3),
    "queuedDraftId" INTEGER,
    "queuedMode" "GameMode",

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT,
    "fen" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "mode" "GameMode" NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" SERIAL NOT NULL,
    "player1Id" INTEGER NOT NULL,
    "player2Id" INTEGER NOT NULL,
    "whitePlayerId" INTEGER NOT NULL,
    "mode" "GameMode" NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "draft1Id" INTEGER,
    "draft2Id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fen" TEXT,
    "prepStartedAt" TIMESTAMP(3),
    "readyPlayer1" BOOLEAN NOT NULL DEFAULT false,
    "readyPlayer2" BOOLEAN NOT NULL DEFAULT false,
    "auxPointsPlayer1" INTEGER NOT NULL DEFAULT 6,
    "auxPointsPlayer2" INTEGER NOT NULL DEFAULT 6,
    "lastMoveAt" TIMESTAMP(3),
    "lastMoveBy" INTEGER,
    "moveNumber" INTEGER NOT NULL DEFAULT 0,
    "player1Timebank" INTEGER NOT NULL DEFAULT 60000,
    "player2Timebank" INTEGER NOT NULL DEFAULT 60000,
    "winnerId" INTEGER,
    "player1EloBefore" INTEGER,
    "player2EloBefore" INTEGER,
    "player1EloAfter" INTEGER,
    "player2EloAfter" INTEGER,
    "eloChange" INTEGER,
    "endReason" TEXT,
    "isFriendGame" BOOLEAN NOT NULL DEFAULT false,
    "pgn" TEXT,
    "rematchRequestedBy" INTEGER,
    "tournamentId" INTEGER,
    "tournamentRound" INTEGER,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenDefinition" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "adminOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mode" "GameMode" NOT NULL DEFAULT 'standard',
    "format" "TournamentFormat" NOT NULL DEFAULT 'single_elimination',
    "status" "TournamentStatus" NOT NULL DEFAULT 'upcoming',
    "registrationEndsAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "maxPlayers" INTEGER,
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "prizeDescription" TEXT,
    "winnerId" INTEGER,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPlayer" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TournamentPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "UserFollow" (
    "id" SERIAL NOT NULL,
    "followerId" INTEGER NOT NULL,
    "followingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" SERIAL NOT NULL,
    "senderId" INTEGER NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameChallenge" (
    "id" SERIAL NOT NULL,
    "senderId" INTEGER NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "mode" "GameMode" NOT NULL DEFAULT 'standard',
    "senderDraftId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_queueStatus_idx" ON "User"("queueStatus");

-- CreateIndex
CREATE INDEX "User_queuedDraftId_idx" ON "User"("queuedDraftId");

-- CreateIndex
CREATE INDEX "User_eloStandard_idx" ON "User"("eloStandard");

-- CreateIndex
CREATE INDEX "User_eloPauper_idx" ON "User"("eloPauper");

-- CreateIndex
CREATE INDEX "User_eloRoyal_idx" ON "User"("eloRoyal");

-- CreateIndex
CREATE INDEX "Draft_userId_idx" ON "Draft"("userId");

-- CreateIndex
CREATE INDEX "Draft_userId_mode_idx" ON "Draft"("userId", "mode");

-- CreateIndex
CREATE INDEX "Draft_updatedAt_idx" ON "Draft"("updatedAt");

-- CreateIndex
CREATE INDEX "Game_player1Id_idx" ON "Game"("player1Id");

-- CreateIndex
CREATE INDEX "Game_player2Id_idx" ON "Game"("player2Id");

-- CreateIndex
CREATE INDEX "Game_whitePlayerId_idx" ON "Game"("whitePlayerId");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE INDEX "Game_mode_idx" ON "Game"("mode");

-- CreateIndex
CREATE INDEX "Game_createdAt_idx" ON "Game"("createdAt");

-- CreateIndex
CREATE INDEX "Game_draft1Id_idx" ON "Game"("draft1Id");

-- CreateIndex
CREATE INDEX "Game_draft2Id_idx" ON "Game"("draft2Id");

-- CreateIndex
CREATE INDEX "Game_winnerId_idx" ON "Game"("winnerId");

-- CreateIndex
CREATE INDEX "Game_lastMoveAt_idx" ON "Game"("lastMoveAt");

-- CreateIndex
CREATE INDEX "Game_tournamentId_idx" ON "Game"("tournamentId");

-- CreateIndex
CREATE INDEX "Game_status_lastMoveAt_idx" ON "Game"("status", "lastMoveAt");

-- CreateIndex
CREATE INDEX "Game_player1Id_mode_createdAt_idx" ON "Game"("player1Id", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "Game_player2Id_mode_createdAt_idx" ON "Game"("player2Id", "mode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenDefinition_slug_key" ON "TokenDefinition"("slug");

-- CreateIndex
CREATE INDEX "TokenDefinition_slug_idx" ON "TokenDefinition"("slug");

-- CreateIndex
CREATE INDEX "UserToken_userId_idx" ON "UserToken"("userId");

-- CreateIndex
CREATE INDEX "UserToken_tokenId_idx" ON "UserToken"("tokenId");

-- CreateIndex
CREATE INDEX "UserToken_expiresAt_idx" ON "UserToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_userId_tokenId_key" ON "UserToken"("userId", "tokenId");

-- CreateIndex
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- CreateIndex
CREATE INDEX "Tournament_mode_idx" ON "Tournament"("mode");

-- CreateIndex
CREATE INDEX "Tournament_startsAt_idx" ON "Tournament"("startsAt");

-- CreateIndex
CREATE INDEX "TournamentPlayer_tournamentId_idx" ON "TournamentPlayer"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentPlayer_userId_idx" ON "TournamentPlayer"("userId");

-- CreateIndex
CREATE INDEX "TournamentPlayer_tournamentId_score_idx" ON "TournamentPlayer"("tournamentId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPlayer_tournamentId_userId_key" ON "TournamentPlayer"("tournamentId", "userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "UserFollow_followerId_idx" ON "UserFollow"("followerId");

-- CreateIndex
CREATE INDEX "UserFollow_followingId_idx" ON "UserFollow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFollow_followerId_followingId_key" ON "UserFollow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "FriendRequest_senderId_idx" ON "FriendRequest"("senderId");

-- CreateIndex
CREATE INDEX "FriendRequest_receiverId_idx" ON "FriendRequest"("receiverId");

-- CreateIndex
CREATE INDEX "FriendRequest_receiverId_status_idx" ON "FriendRequest"("receiverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequest_senderId_receiverId_key" ON "FriendRequest"("senderId", "receiverId");

-- CreateIndex
CREATE INDEX "GameChallenge_senderId_idx" ON "GameChallenge"("senderId");

-- CreateIndex
CREATE INDEX "GameChallenge_receiverId_idx" ON "GameChallenge"("receiverId");

-- CreateIndex
CREATE INDEX "GameChallenge_receiverId_status_idx" ON "GameChallenge"("receiverId", "status");

-- CreateIndex
CREATE INDEX "GameChallenge_expiresAt_idx" ON "GameChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_queuedDraftId_fkey" FOREIGN KEY ("queuedDraftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_whitePlayerId_fkey" FOREIGN KEY ("whitePlayerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_draft1Id_fkey" FOREIGN KEY ("draft1Id") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_draft2Id_fkey" FOREIGN KEY ("draft2Id") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "TokenDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameChallenge" ADD CONSTRAINT "GameChallenge_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameChallenge" ADD CONSTRAINT "GameChallenge_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameChallenge" ADD CONSTRAINT "GameChallenge_senderDraftId_fkey" FOREIGN KEY ("senderDraftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
