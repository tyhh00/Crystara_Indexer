-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "description" TEXT,
ADD COLUMN     "propertyKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "propertyTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "propertyValues" JSONB,
ADD COLUMN     "royaltyPayeeAddress" TEXT,
ADD COLUMN     "royaltyPointsDenominator" BIGINT,
ADD COLUMN     "royaltyPointsNumerator" BIGINT;
