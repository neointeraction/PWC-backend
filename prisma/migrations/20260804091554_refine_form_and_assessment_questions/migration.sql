-- CreateEnum
CREATE TYPE "AssessmentSection" AS ENUM ('RIASEC', 'BIG_FIVE', 'APTITUDE', 'COGNITIVE');

-- CreateEnum
CREATE TYPE "AssessmentQuestionFormat" AS ENUM ('LIKERT_5', 'MCQ_SINGLE');

-- CreateEnum
CREATE TYPE "AssessmentDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuestionType" ADD VALUE 'SHORT_TEXT';
ALTER TYPE "QuestionType" ADD VALUE 'NUMBER';
ALTER TYPE "QuestionType" ADD VALUE 'MATRIX';

-- AlterTable
ALTER TABLE "assessment_questions" ADD COLUMN     "correctOption" TEXT,
ADD COLUMN     "difficulty" "AssessmentDifficulty",
ADD COLUMN     "fieldKey" TEXT NOT NULL,
ADD COLUMN     "format" "AssessmentQuestionFormat" NOT NULL,
ADD COLUMN     "questionCode" TEXT NOT NULL,
ADD COLUMN     "section" "AssessmentSection" NOT NULL,
ADD COLUMN     "traitCode" TEXT,
ALTER COLUMN "options" DROP NOT NULL;

-- AlterTable
ALTER TABLE "form_questions" ADD COLUMN     "allowOtherText" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fieldKey" TEXT NOT NULL,
ADD COLUMN     "helpText" TEXT,
ADD COLUMN     "otherTextFieldKey" TEXT,
ADD COLUMN     "questionCode" TEXT NOT NULL,
ADD COLUMN     "sectionLabel" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_cohort_fieldKey_key" ON "assessment_questions"("cohort", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "form_questions_formTemplateId_fieldKey_key" ON "form_questions"("formTemplateId", "fieldKey");

