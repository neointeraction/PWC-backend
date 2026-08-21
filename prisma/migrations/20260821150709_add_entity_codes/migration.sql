-- Human-readable entity codes: Student "S0001", Counsellor "C0001", Project "P0001".

-- AlterTable: nullable project code (service always sets it on create; nullable covers
-- the pre-code backfill and raw test fixtures).
ALTER TABLE "projects" ADD COLUMN     "code" TEXT;

-- CreateTable: monotonic counters, one row per entity type.
CREATE TABLE "code_sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- Backfill existing projects with P-codes in creation order.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn
  FROM "projects"
)
UPDATE "projects" p
SET "code" = 'P' || LPAD(numbered.rn::text, 4, '0')
FROM numbered
WHERE p."id" = numbered."id";

-- Seed the counters at the current row counts so new codes continue the sequence.
-- Projects continue after the backfilled P-codes above; students/counsellors start
-- issuing S/C codes after however many rows already exist (their legacy codes are a
-- different format, so no collision).
INSERT INTO "code_sequences" ("key", "value", "updatedAt") VALUES
  ('STUDENT',    (SELECT COUNT(*) FROM "students")::int,    NOW()),
  ('COUNSELLOR', (SELECT COUNT(*) FROM "counsellors")::int, NOW()),
  ('PROJECT',    (SELECT COUNT(*) FROM "projects")::int,    NOW());
