/*
  Warnings:

  - You are about to drop the column `raritiesColorMap` on the `OFFChain_LootboxStats` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OFFChain_LootboxStats" DROP COLUMN "raritiesColorMap",
ADD COLUMN     "rarityColorMap" TEXT;
