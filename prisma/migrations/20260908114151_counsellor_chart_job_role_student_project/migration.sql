/*
  Warnings:

  - You are about to drop the column `collegesTable` on the `counsellor_charts` table. All the data in the column will be lost.
  - You are about to drop the column `entranceExamsTable` on the `counsellor_charts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "career_library_entries" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "studentId" TEXT;

-- AlterTable
ALTER TABLE "career_library_entry_proposals" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "studentId" TEXT;

-- AlterTable
ALTER TABLE "counsellor_charts" DROP COLUMN "collegesTable",
DROP COLUMN "entranceExamsTable";

-- CreateIndex
CREATE INDEX "career_library_entries_studentId_idx" ON "career_library_entries"("studentId");

-- CreateIndex
CREATE INDEX "career_library_entry_proposals_studentId_idx" ON "career_library_entry_proposals"("studentId");

-- AddForeignKey
ALTER TABLE "career_library_entries" ADD CONSTRAINT "career_library_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_library_entries" ADD CONSTRAINT "career_library_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_library_entry_proposals" ADD CONSTRAINT "career_library_entry_proposals_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_library_entry_proposals" ADD CONSTRAINT "career_library_entry_proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
