/*
  Warnings:

  - You are about to drop the `domain_education_entries` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "career_education_entries" DROP CONSTRAINT "career_education_entries_educationEntryId_fkey";

-- DropForeignKey
ALTER TABLE "domain_education_entries" DROP CONSTRAINT "domain_education_entries_domainId_fkey";

-- DropTable
DROP TABLE "domain_education_entries";

-- CreateTable
CREATE TABLE "education_entries" (
    "id" TEXT NOT NULL,
    "level" "EducationPathLevel" NOT NULL,
    "programme" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMP(3),
    "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "education_entries_programme_idx" ON "education_entries"("programme");

-- CreateIndex
CREATE INDEX "education_entries_status_idx" ON "education_entries"("status");

-- AddForeignKey
ALTER TABLE "career_education_entries" ADD CONSTRAINT "career_education_entries_educationEntryId_fkey" FOREIGN KEY ("educationEntryId") REFERENCES "education_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
