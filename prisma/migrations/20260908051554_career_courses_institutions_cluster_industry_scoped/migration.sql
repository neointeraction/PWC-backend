-- Courses and institutions move from being curated per job role (career_courses /
-- career_institutions keyed by careerEntryId) to being shared: courses at the career-cluster
-- level, institutions at the industry level. Every job role under the same cluster now shows
-- the same course list, and every job role under the same industry shows the same institution
-- list — adding/removing one from any job role's screen reflects on every sibling role.

-- --- career_courses: careerEntryId -> clusterId --------------------------------------------

ALTER TABLE "career_courses" ADD COLUMN "clusterId" TEXT;

UPDATE "career_courses" cc
SET "clusterId" = cl."id"
FROM "career_library_entries" e
JOIN "career_domains" d ON d."id" = e."domainId"
JOIN "career_industries" i ON i."id" = d."industryId"
JOIN "career_clusters" cl ON cl."id" = i."clusterId"
WHERE e."id" = cc."careerEntryId";

-- Several job roles under the same cluster may already have linked the same course
-- independently — those collapse into one row now that the key is (clusterId, courseId).
DELETE FROM "career_courses" a USING "career_courses" b
WHERE a.ctid < b.ctid
  AND a."clusterId" = b."clusterId"
  AND a."courseId" = b."courseId";

ALTER TABLE "career_courses" DROP CONSTRAINT "career_courses_pkey";
ALTER TABLE "career_courses" DROP COLUMN "careerEntryId";
ALTER TABLE "career_courses" ALTER COLUMN "clusterId" SET NOT NULL;
ALTER TABLE "career_courses" ADD CONSTRAINT "career_courses_pkey" PRIMARY KEY ("clusterId", "courseId");
ALTER TABLE "career_courses" ADD CONSTRAINT "career_courses_clusterId_fkey"
  FOREIGN KEY ("clusterId") REFERENCES "career_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- career_institutions: careerEntryId -> industryId --------------------------------------

ALTER TABLE "career_institutions" ADD COLUMN "industryId" TEXT;

UPDATE "career_institutions" ci
SET "industryId" = i."id"
FROM "career_library_entries" e
JOIN "career_domains" d ON d."id" = e."domainId"
JOIN "career_industries" i ON i."id" = d."industryId"
WHERE e."id" = ci."careerEntryId";

DELETE FROM "career_institutions" a USING "career_institutions" b
WHERE a.ctid < b.ctid
  AND a."industryId" = b."industryId"
  AND a."institutionId" = b."institutionId";

ALTER TABLE "career_institutions" DROP CONSTRAINT "career_institutions_pkey";
ALTER TABLE "career_institutions" DROP COLUMN "careerEntryId";
ALTER TABLE "career_institutions" ALTER COLUMN "industryId" SET NOT NULL;
ALTER TABLE "career_institutions" ADD CONSTRAINT "career_institutions_pkey" PRIMARY KEY ("industryId", "institutionId");
ALTER TABLE "career_institutions" ADD CONSTRAINT "career_institutions_industryId_fkey"
  FOREIGN KEY ("industryId") REFERENCES "career_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
