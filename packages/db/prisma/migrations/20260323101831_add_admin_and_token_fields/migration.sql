/*
  Warnings:

  - A unique constraint covering the columns `[stripePriceId]` on the table `TokenDefinition` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `TokenDefinition` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TokenDefinition" ADD COLUMN     "consumeOnEntry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPurchasable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePriceId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE INDEX "AdminUser_username_idx" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "TokenDefinition_stripePriceId_key" ON "TokenDefinition"("stripePriceId");

-- CreateIndex
CREATE INDEX "TokenDefinition_isPurchasable_idx" ON "TokenDefinition"("isPurchasable");
