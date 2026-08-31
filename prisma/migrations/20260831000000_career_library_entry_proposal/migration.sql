-- Stage counsellor-submitted job roles in a separate table instead of the real
-- career_library_entries table (see CareerLibraryEntryProposal). Admin adds/approvals still
-- write career_library_entries directly.
--
-- entrance_exams / institutions / courses collapse from the 3-state ReviewStatus
-- (PENDING/APPROVED/REJECTED) to the same DRAFT/ACTIVE CareerLibraryStatus flag
-- EducationEntry/CareerLibraryEntry already use: PENDING -> DRAFT, APPROVED -> ACTIVE,
-- REJECTED -> DRAFT (a rejected row is deleted going forward, so this only matters for
-- any row already sitting REJECTED at migration time). The reviewedBy/reviewedAt/
-- rejectionReason audit columns are dropped along with it.

-- entrance_exams
ALTER TABLE "entrance_exams" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "entrance_exams"
  ALTER COLUMN "status" TYPE "CareerLibraryStatus" USING (
    CASE "status"::text
      WHEN 'APPROVED' THEN 'ACTIVE'
      ELSE 'DRAFT'
    END
  )::"CareerLibraryStatus";
ALTER TABLE "entrance_exams" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "entrance_exams" DROP COLUMN "reviewedBy";
ALTER TABLE "entrance_exams" DROP COLUMN "reviewedAt";
ALTER TABLE "entrance_exams" DROP COLUMN "rejectionReason";

-- institutions
ALTER TABLE "institutions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "institutions"
  ALTER COLUMN "status" TYPE "CareerLibraryStatus" USING (
    CASE "status"::text
      WHEN 'APPROVED' THEN 'ACTIVE'
      ELSE 'DRAFT'
    END
  )::"CareerLibraryStatus";
ALTER TABLE "institutions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "institutions" DROP COLUMN "reviewedBy";
ALTER TABLE "institutions" DROP COLUMN "reviewedAt";
ALTER TABLE "institutions" DROP COLUMN "rejectionReason";

-- courses
ALTER TABLE "courses" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "courses"
  ALTER COLUMN "status" TYPE "CareerLibraryStatus" USING (
    CASE "status"::text
      WHEN 'APPROVED' THEN 'ACTIVE'
      ELSE 'DRAFT'
    END
  )::"CareerLibraryStatus";
ALTER TABLE "courses" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "courses" DROP COLUMN "reviewedBy";
ALTER TABLE "courses" DROP COLUMN "reviewedAt";
ALTER TABLE "courses" DROP COLUMN "rejectionReason";

-- career_library_entries: drop the reviewStatus column now that a counsellor never writes
-- this table directly (see career_library_entry_proposals below).
DROP INDEX IF EXISTS "career_library_entries_reviewStatus_idx";
ALTER TABLE "career_library_entries" DROP COLUMN "reviewStatus";
ALTER TABLE "career_library_entries" DROP COLUMN "reviewedBy";
ALTER TABLE "career_library_entries" DROP COLUMN "reviewedAt";

-- The ReviewStatus enum has no remaining columns using it.
DROP TYPE "ReviewStatus";

-- CareerLibraryEntryProposal: a counsellor's staged job-role submission.
CREATE TABLE "career_library_entry_proposals" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "jobRole" TEXT NOT NULL,
    "aiResilienceGrade" "AiResilienceGrade" NOT NULL,
    "aiResilienceComment" TEXT NOT NULL,
    "oneLineDescription" TEXT NOT NULL,
    "roleOverview" TEXT,
    "keySkills" TEXT[],
    "topCompanies" TEXT[],
    "salaryIndiaRangeText" TEXT,
    "salaryIndiaMinLPA" DOUBLE PRECISION,
    "salaryIndiaMaxLPA" DOUBLE PRECISION,
    "salaryGlobalRangeText" TEXT,
    "salaryGlobalMinUSD" DOUBLE PRECISION,
    "salaryGlobalMaxUSD" DOUBLE PRECISION,
    "qualification10th12th" TEXT,
    "qualification10th12thExplanation" TEXT,
    "qualificationGraduation" TEXT,
    "qualificationGraduationDefined" TEXT,
    "qualificationPG" TEXT,
    "qualificationPGDefined" TEXT,
    "entranceExamsUGDescription" TEXT,
    "certificationsStudent" TEXT[],
    "certificationsUG" TEXT[],
    "examIds" TEXT[],
    "courseIds" TEXT[],
    "institutionIds" TEXT[],
    "educationEntryIds" TEXT[],
    "submittedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_library_entry_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_library_entry_proposals_domainId_idx" ON "career_library_entry_proposals"("domainId");
