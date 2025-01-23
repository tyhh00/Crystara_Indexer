-- CreateTable
CREATE TABLE "OFFChain_Account" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "preferences" JSONB,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OFFChain_Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OFFChain_LootboxStats" (
    "id" SERIAL NOT NULL,
    "lootboxId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "trendingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "categories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OFFChain_LootboxStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OFFChain_LootboxLike" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "lootboxStatsId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OFFChain_LootboxLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OFFChain_LootboxView" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "lootboxStatsId" INTEGER NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OFFChain_LootboxView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_Account_walletAddress_key" ON "OFFChain_Account"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_Account_email_key" ON "OFFChain_Account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_Account_username_key" ON "OFFChain_Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_LootboxStats_lootboxId_key" ON "OFFChain_LootboxStats"("lootboxId");

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_LootboxStats_url_key" ON "OFFChain_LootboxStats"("url");

-- CreateIndex
CREATE INDEX "OFFChain_LootboxStats_url_idx" ON "OFFChain_LootboxStats"("url");

-- CreateIndex
CREATE UNIQUE INDEX "OFFChain_LootboxLike_accountId_lootboxStatsId_key" ON "OFFChain_LootboxLike"("accountId", "lootboxStatsId");

-- CreateIndex
CREATE INDEX "OFFChain_LootboxView_accountId_idx" ON "OFFChain_LootboxView"("accountId");

-- CreateIndex
CREATE INDEX "OFFChain_LootboxView_lootboxStatsId_idx" ON "OFFChain_LootboxView"("lootboxStatsId");

-- CreateIndex
CREATE INDEX "OFFChain_LootboxView_viewedAt_idx" ON "OFFChain_LootboxView"("viewedAt");

-- AddForeignKey
ALTER TABLE "OFFChain_LootboxLike" ADD CONSTRAINT "OFFChain_LootboxLike_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OFFChain_Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OFFChain_LootboxLike" ADD CONSTRAINT "OFFChain_LootboxLike_lootboxStatsId_fkey" FOREIGN KEY ("lootboxStatsId") REFERENCES "OFFChain_LootboxStats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OFFChain_LootboxView" ADD CONSTRAINT "OFFChain_LootboxView_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OFFChain_Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OFFChain_LootboxView" ADD CONSTRAINT "OFFChain_LootboxView_lootboxStatsId_fkey" FOREIGN KEY ("lootboxStatsId") REFERENCES "OFFChain_LootboxStats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
