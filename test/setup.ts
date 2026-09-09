process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://pwc:pwc_dev_password@localhost:5432/pwc_counselling_test?schema=public";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
// Never hit a real email provider from tests — force the console (no-op) provider even
// if the local .env selects Mailgun. Set before env.ts loads (dotenv won't override it).
process.env.EMAIL_PROVIDER = "console";

// The assessment scoring engine reads its trait/weightage/guidance reference data from
// an in-memory cache (src/modules/assessment/scoring/data/store.ts) backed by the DB —
// load it once per test file here so any test that calls scoreAssessment() (directly,
// or indirectly via the assessment-submission/reports/counsellor-chart APIs) works.
// Requires the test DB to be migrated + seeded: `pnpm db:seed:scoring` against it.
const { loadScoringReferenceData } = await import(
  "../src/modules/assessment/scoring/data/store.js"
);
await loadScoringReferenceData();
