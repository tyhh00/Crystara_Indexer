/*
  Warnings:

  - A unique constraint covering the columns `[accountAddress,tokenDataId,propertyVersion]` on the table `TokenBalance` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "TokenBalance_accountAddress_tokenDataId_key";

-- DropIndex
DROP INDEX "TokenBalance_lastUpdated_idx";

-- AlterTable
ALTER TABLE "Token" ALTER COLUMN "propertyVersion" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "TokenBalance" ADD COLUMN     "propertyVersion" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PropertyMap" (
    "id" SERIAL NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "propertyVersion" BIGINT NOT NULL,
    "keys" TEXT[],
    "values" JSONB NOT NULL,
    "types" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyMap_tokenId_idx" ON "PropertyMap"("tokenId");

-- CreateIndex
CREATE INDEX "PropertyMap_propertyVersion_idx" ON "PropertyMap"("propertyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyMap_tokenId_propertyVersion_key" ON "PropertyMap"("tokenId", "propertyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TokenBalance_accountAddress_tokenDataId_propertyVersion_key" ON "TokenBalance"("accountAddress", "tokenDataId", "propertyVersion");

-- AddForeignKey
ALTER TABLE "PropertyMap" ADD CONSTRAINT "PropertyMap_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
