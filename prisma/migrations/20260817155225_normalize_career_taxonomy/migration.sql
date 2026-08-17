-- Normalize the career-library taxonomy (cluster / industry / domain) out of the free-text
-- string columns on career_library_entries into a 3-level hierarchy of tables, then repoint
-- each entry at its leaf domain. Ordered so the backfill runs before the string columns drop.
--
-- Name uniqueness (among live rows) is enforced in the application service layer, not by a DB
-- constraint: a partial unique index cannot be represented in the Prisma schema, so it would be
-- reported as drift and dropped by the next `prisma migrate dev`. The taxonomy is tiny and
-- admin-only, so service-level checks are sufficient.

-- CreateTable
CREATE TABLE "career_clusters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_industries" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_domains" (
    "id" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "career_industries_clusterId_idx" ON "career_industries"("clusterId");

-- CreateIndex
CREATE INDEX "career_domains_industryId_idx" ON "career_domains"("industryId");

-- AddForeignKey
ALTER TABLE "career_industries" ADD CONSTRAINT "career_industries_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "career_clusters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_domains" ADD CONSTRAINT "career_domains_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "career_industries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add the leaf FK column (nullable for now; backfilled below, then set NOT NULL).
ALTER TABLE "career_library_entries" ADD COLUMN "domainId" TEXT;

-- Backfill: build the hierarchy from the existing distinct string values. gen_random_uuid() is a
-- Postgres 13+ builtin; mixed uuid/cuid ids are fine since the id column is just TEXT.
INSERT INTO "career_clusters" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t.cluster, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "cluster" AS cluster FROM "career_library_entries") t;

INSERT INTO "career_industries" ("id", "clusterId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", t.industry, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "cluster" AS cluster, "industry" AS industry FROM "career_library_entries") t
JOIN "career_clusters" c ON c."name" = t.cluster;

INSERT INTO "career_domains" ("id", "industryId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, i."id", t.domain, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "cluster" AS cluster, "industry" AS industry, "domain" AS domain FROM "career_library_entries") t
JOIN "career_clusters" c ON c."name" = t.cluster
JOIN "career_industries" i ON i."clusterId" = c."id" AND i."name" = t.industry;

-- Point each entry at its leaf domain (industry+cluster join disambiguates domain names reused
-- across industries).
UPDATE "career_library_entries" e
SET "domainId" = d."id"
FROM "career_domains" d
JOIN "career_industries" i ON i."id" = d."industryId"
JOIN "career_clusters" c ON c."id" = i."clusterId"
WHERE c."name" = e."cluster" AND i."name" = e."industry" AND d."name" = e."domain";

-- Every row is now backfilled — enforce NOT NULL and wire up the FK + index.
ALTER TABLE "career_library_entries" ALTER COLUMN "domainId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "career_library_entries" ADD CONSTRAINT "career_library_entries_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "career_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "career_library_entries_domainId_idx" ON "career_library_entries"("domainId");

-- Drop the old free-text classification columns and their indexes.
DROP INDEX "career_library_entries_cluster_idx";
DROP INDEX "career_library_entries_industry_idx";
DROP INDEX "career_library_entries_domain_idx";
ALTER TABLE "career_library_entries" DROP COLUMN "cluster";
ALTER TABLE "career_library_entries" DROP COLUMN "industry";
ALTER TABLE "career_library_entries" DROP COLUMN "domain";
