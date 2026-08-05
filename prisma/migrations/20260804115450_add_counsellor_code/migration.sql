-- AlterTable
ALTER TABLE "counsellors" ADD COLUMN     "counsellorCode" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "counsellors_counsellorCode_key" ON "counsellors"("counsellorCode");

