-- AlterTable
ALTER TABLE "RoboBatchRecipe" ADD COLUMN     "isTrial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RoboBatchRecipeEntry" ADD COLUMN     "liquidSetting" TEXT,
ADD COLUMN     "powderSetting" TEXT;

-- CreateTable
CREATE TABLE "RoboReferencePhoto" (
    "id" TEXT NOT NULL,
    "batchRecipeId" TEXT,
    "machineId" TEXT,
    "kind" TEXT,
    "originalData" BYTEA NOT NULL,
    "originalType" TEXT NOT NULL,
    "originalName" TEXT,
    "editedData" BYTEA,
    "editedType" TEXT,
    "edits" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboReferencePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoboReferencePhoto_batchRecipeId_idx" ON "RoboReferencePhoto"("batchRecipeId");

-- CreateIndex
CREATE INDEX "RoboReferencePhoto_createdAt_idx" ON "RoboReferencePhoto"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoboReferencePhoto_batchRecipeId_machineId_kind_key" ON "RoboReferencePhoto"("batchRecipeId", "machineId", "kind");

-- AddForeignKey
ALTER TABLE "RoboReferencePhoto" ADD CONSTRAINT "RoboReferencePhoto_batchRecipeId_fkey" FOREIGN KEY ("batchRecipeId") REFERENCES "RoboBatchRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

