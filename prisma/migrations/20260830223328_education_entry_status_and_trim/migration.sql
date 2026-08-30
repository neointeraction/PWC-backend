-- Education Path entries: DRAFT/ACTIVE publish flag instead of the review workflow, and
-- no soft delete. Existing rows were all seeded APPROVED -> ACTIVE; anything still PENDING
-- or REJECTED becomes DRAFT (not offered in the pickers), which preserves visibility.

ALTER TABLE "education_entries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "education_entries"
  ALTER COLUMN "status" TYPE "CareerLibraryStatus"
  USING (CASE WHEN "status"::text = 'APPROVED' THEN 'ACTIVE' ELSE 'DRAFT' END)::"CareerLibraryStatus";
ALTER TABLE "education_entries" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Review/soft-delete bookkeeping, no longer used.
ALTER TABLE "education_entries"
  DROP COLUMN "reviewedBy",
  DROP COLUMN "reviewedAt",
  DROP COLUMN "rejectionReason",
  DROP COLUMN "deletedAt";

-- With no soft-deleted rows to keep a name occupied, uniqueness belongs in the DB
-- (matching entrance_exams / courses / institutions).
CREATE UNIQUE INDEX "education_entries_level_programme_key" ON "education_entries"("level", "programme");
