-- Send-side dedup timestamps for the in-process reminder/nudge scheduler (src/scheduler).
-- Both nullable: null means "not yet sent". Ageing/flag detection itself stays derived
-- (never stored) — only the fact that an email went out is recorded, to avoid re-sending.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "dayReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "lastNudgeAt" TIMESTAMP(3);
