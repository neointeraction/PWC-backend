/*
  Warnings:

  - Added the required column `report` to the `assessment_results` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "assessment_answers" ADD COLUMN     "timeTakenMs" INTEGER;

-- AlterTable
ALTER TABLE "assessment_results" ADD COLUMN     "dominantCareerStyle" TEXT,
ADD COLUMN     "dominantPersonalityStyle" TEXT,
ADD COLUMN     "engineVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "report" JSONB NOT NULL;
