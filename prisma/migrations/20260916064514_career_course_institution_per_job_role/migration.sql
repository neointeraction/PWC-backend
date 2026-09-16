-- Courses and institutions move back from being shared (career_courses keyed by clusterId,
-- career_institutions keyed by industryId) to being curated per job role (careerEntryId),
-- reverting 20260908051554_career_courses_institutions_cluster_industry_scoped. Editing one
-- job role's courses/institutions must no longer affect a sibling role's, even under the same
-- cluster/industry — matching how career_entrance_exams already works.
--
-- Backfill: every job role currently rolling up to a cluster/industry starts with that
-- cluster's/industry's current list (a one-time expand — one course/institution row becomes
-- one row per job role under it); each role's list is independently editable afterward.

-- --- career_courses: clusterId -> careerEntryId ---------------------------------------------

CREATE TABLE "_cc_expand" AS
SELECT e."id" AS "careerEntryId", cc."courseId", cc."createdAt"
FROM "career_courses" cc
JOIN "career_industries" i ON i."clusterId" = cc."clusterId"
JOIN "career_domains" d ON d."industryId" = i."id"
JOIN "career_library_entries" e ON e."domainId" = d."id";

ALTER TABLE "career_courses" DROP CONSTRAINT "career_courses_pkey";
ALTER TABLE "career_courses" DROP CONSTRAINT "career_courses_clusterId_fkey";
DELETE FROM "career_courses";
ALTER TABLE "career_courses" DROP COLUMN "clusterId";
ALTER TABLE "career_courses" ADD COLUMN "careerEntryId" TEXT;

INSERT INTO "career_courses" ("careerEntryId", "courseId", "createdAt")
SELECT "careerEntryId", "courseId", "createdAt" FROM "_cc_expand";

ALTER TABLE "career_courses" ALTER COLUMN "careerEntryId" SET NOT NULL;
ALTER TABLE "career_courses" ADD CONSTRAINT "career_courses_pkey" PRIMARY KEY ("careerEntryId", "courseId");
ALTER TABLE "career_courses" ADD CONSTRAINT "career_courses_careerEntryId_fkey"
  FOREIGN KEY ("careerEntryId") REFERENCES "career_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "_cc_expand";

-- --- career_institutions: industryId -> careerEntryId ----------------------------------------

CREATE TABLE "_ci_expand" AS
SELECT e."id" AS "careerEntryId", ci."institutionId", ci."createdAt"
FROM "career_institutions" ci
JOIN "career_domains" d ON d."industryId" = ci."industryId"
JOIN "career_library_entries" e ON e."domainId" = d."id";

ALTER TABLE "career_institutions" DROP CONSTRAINT "career_institutions_pkey";
ALTER TABLE "career_institutions" DROP CONSTRAINT "career_institutions_industryId_fkey";
DELETE FROM "career_institutions";
ALTER TABLE "career_institutions" DROP COLUMN "industryId";
ALTER TABLE "career_institutions" ADD COLUMN "careerEntryId" TEXT;

INSERT INTO "career_institutions" ("careerEntryId", "institutionId", "createdAt")
SELECT "careerEntryId", "institutionId", "createdAt" FROM "_ci_expand";

ALTER TABLE "career_institutions" ALTER COLUMN "careerEntryId" SET NOT NULL;
ALTER TABLE "career_institutions" ADD CONSTRAINT "career_institutions_pkey" PRIMARY KEY ("careerEntryId", "institutionId");
ALTER TABLE "career_institutions" ADD CONSTRAINT "career_institutions_careerEntryId_fkey"
  FOREIGN KEY ("careerEntryId") REFERENCES "career_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "_ci_expand";
