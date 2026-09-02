-- Codes are now supplied by the admin on create instead of auto-generated, so the
-- monotonic counter table is no longer needed.
DROP TABLE "code_sequences";

-- Project.code is now always supplied on create (no more service-side fallback), so make
-- it required. No backfill needed: the service has always set it, so no row has a null
-- code today.
ALTER TABLE "projects" ALTER COLUMN "code" SET NOT NULL;
