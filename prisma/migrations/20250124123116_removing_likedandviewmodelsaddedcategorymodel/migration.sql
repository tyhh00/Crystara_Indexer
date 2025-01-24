/*
  Warnings:

  - You are about to drop the column `rarityiesColorMap` on the `OFFChain_LootboxStats` table. All the data in the column will be lost.
  - You are about to drop the `OFFChain_LootboxLike` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OFFChain_LootboxView` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "OFFChain_LootboxLike" DROP CONSTRAINT "OFFChain_LootboxLike_accountId_fkey";

-- DropForeignKey
ALTER TABLE "OFFChain_LootboxLike" DROP CONSTRAINT "OFFChain_LootboxLike_lootboxStatsId_fkey";

-- DropForeignKey
ALTER TABLE "OFFChain_LootboxView" DROP CONSTRAINT "OFFChain_LootboxView_accountId_fkey";

-- DropForeignKey
ALTER TABLE "OFFChain_LootboxView" DROP CONSTRAINT "OFFChain_LootboxView_lootboxStatsId_fkey";

-- AlterTable
ALTER TABLE "OFFChain_LootboxStats" DROP COLUMN "rarityiesColorMap",
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "OFFChain_LootboxLike";

-- DropTable
DROP TABLE "OFFChain_LootboxView";

-- CreateTable
CREATE TABLE "OFFChain_Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OFFChain_Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_Category_name_key" ON "OFFChain_Category"("name");
