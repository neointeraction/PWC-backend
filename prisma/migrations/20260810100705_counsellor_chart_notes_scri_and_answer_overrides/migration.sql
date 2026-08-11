-- CreateEnum
CREATE TYPE "AcademicTrend" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "AlignmentRating" AS ENUM ('STRONGLY_ALIGNED', 'PARTIALLY_ALIGNED', 'MISALIGNED', 'NOT_YET_ASSESSED');

-- AlterTable
ALTER TABLE "assessment_answers" ADD COLUMN     "counsellorOverrideOption" JSONB,
ADD COLUMN     "overriddenAt" TIMESTAMP(3),
ADD COLUMN     "overriddenByCounsellorId" TEXT;

-- AlterTable
ALTER TABLE "counsellor_charts" ADD COLUMN     "academicTrend" "AcademicTrend",
ADD COLUMN     "alignmentRating" "AlignmentRating",
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "scriBand" INTEGER,
ADD COLUMN     "scriBandLabel" TEXT,
ADD COLUMN     "scriCareerCuriosity" INTEGER,
ADD COLUMN     "scriConfidence" INTEGER,
ADD COLUMN     "scriDecisionOwnership" INTEGER,
ADD COLUMN     "scriReasonedThinking" INTEGER,
ADD COLUMN     "scriReducedAnxiety" INTEGER,
ADD COLUMN     "scriSelfAwareness" INTEGER,
ADD COLUMN     "scriTotal" INTEGER,
ALTER COLUMN "rawData" DROP NOT NULL;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "academicYear" TEXT;

-- CreateTable
CREATE TABLE "counsellor_chart_notes" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counsellor_chart_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "counsellor_chart_notes_chartId_code_key" ON "counsellor_chart_notes"("chartId", "code");

-- AddForeignKey
ALTER TABLE "counsellor_chart_notes" ADD CONSTRAINT "counsellor_chart_notes_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "counsellor_charts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
