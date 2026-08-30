-- AlterTable
ALTER TABLE "career_library_entries" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- CreateIndex
CREATE INDEX "career_library_entries_reviewStatus_idx" ON "career_library_entries"("reviewStatus");
