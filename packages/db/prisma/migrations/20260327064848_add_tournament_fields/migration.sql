/*
  Warnings:

  - You are about to drop the column `tournamentRound` on the `Game` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Game" DROP COLUMN "tournamentRound",
ADD COLUMN     "tournamentRoundId" INTEGER;

-- AlterTable
ALTER TABLE "TokenDefinition" ADD COLUMN     "durationDays" INTEGER;

-- AlterTable
ALTER TABLE "TournamentPlayer" ADD COLUMN     "buchholz" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TournamentStage" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "stageNumber" INTEGER NOT NULL,
    "name" TEXT,
    "format" "TournamentFormat" NOT NULL,
    "advanceCount" INTEGER,
    "startTimeType" TEXT NOT NULL DEFAULT 'fixed',
    "fixedStartAt" TIMESTAMP(3),
    "relativeBreakMinutes" INTEGER,
    "totalRounds" INTEGER,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRound" (
    "id" SERIAL NOT NULL,
    "stageId" INTEGER NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "draftPickDeadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'awaiting_drafts',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentGame" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "gameId" INTEGER,
    "player1Id" INTEGER NOT NULL,
    "player2Id" INTEGER NOT NULL,
    "player1DraftId" INTEGER,
    "player2DraftId" INTEGER,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "winnerId" INTEGER,
    "isDraw" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TournamentGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStagePlacement" (
    "id" SERIAL NOT NULL,
    "stageId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "rankLabel" TEXT,

    CONSTRAINT "TournamentStagePlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPrize" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "rankFrom" INTEGER NOT NULL,
    "rankTo" INTEGER NOT NULL,
    "prizeType" TEXT NOT NULL DEFAULT 'token',
    "tokenSlug" TEXT,
    "description" TEXT,

    CONSTRAINT "TournamentPrize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentStage_tournamentId_idx" ON "TournamentStage"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentStage_status_idx" ON "TournamentStage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_tournamentId_stageNumber_key" ON "TournamentStage"("tournamentId", "stageNumber");

-- CreateIndex
CREATE INDEX "TournamentRound_stageId_idx" ON "TournamentRound"("stageId");

-- CreateIndex
CREATE INDEX "TournamentRound_status_idx" ON "TournamentRound"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRound_stageId_roundNumber_key" ON "TournamentRound"("stageId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentGame_gameId_key" ON "TournamentGame"("gameId");

-- CreateIndex
CREATE INDEX "TournamentGame_roundId_idx" ON "TournamentGame"("roundId");

-- CreateIndex
CREATE INDEX "TournamentGame_gameId_idx" ON "TournamentGame"("gameId");

-- CreateIndex
CREATE INDEX "TournamentGame_player1Id_idx" ON "TournamentGame"("player1Id");

-- CreateIndex
CREATE INDEX "TournamentGame_player2Id_idx" ON "TournamentGame"("player2Id");

-- CreateIndex
CREATE INDEX "TournamentStagePlacement_stageId_idx" ON "TournamentStagePlacement"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStagePlacement_stageId_userId_key" ON "TournamentStagePlacement"("stageId", "userId");

-- CreateIndex
CREATE INDEX "TournamentPrize_tournamentId_idx" ON "TournamentPrize"("tournamentId");

-- CreateIndex
CREATE INDEX "Game_tournamentRoundId_idx" ON "Game"("tournamentRoundId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_tournamentRoundId_fkey" FOREIGN KEY ("tournamentRoundId") REFERENCES "TournamentRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRound" ADD CONSTRAINT "TournamentRound_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TournamentRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStagePlacement" ADD CONSTRAINT "TournamentStagePlacement_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPrize" ADD CONSTRAINT "TournamentPrize_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
