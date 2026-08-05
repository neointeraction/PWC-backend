-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PROFILE_COMPLETED', 'PRE_COUNSELLING_FORMS_SUBMITTED', 'ASSESSMENT_PENDING', 'ASSESSMENT_COMPLETED', 'SESSION_SCHEDULED', 'SESSION_1_COMPLETED', 'COUNSELLOR_FEEDBACK_REPORT', 'SESSION_2_COMPLETED', 'COUNSELLOR_FEEDBACK', 'STUDENT_PARENT_FEEDBACK', 'CLOSED');

-- CreateEnum
CREATE TYPE "SessionNumber" AS ENUM ('SESSION_1', 'SESSION_2');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'RESCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('STUDENT_UNAVAILABLE', 'COUNSELLOR_UNAVAILABLE', 'INSTITUTION_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "AiResilienceGrade" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "CareerLibraryStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "CareerRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('STUDENT_PROFILE', 'PRE_COUNSELLING_STUDENT', 'PRE_COUNSELLING_PARENT', 'FEEDBACK_STUDENT', 'FEEDBACK_PARENT');

-- CreateEnum
CREATE TYPE "SubmittedByRole" AS ENUM ('STUDENT', 'PARENT');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ_SINGLE', 'MCQ_MULTI', 'OPEN_TEXT', 'SCALE');

-- CreateEnum
CREATE TYPE "AssessmentAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('STUDENT_CAREER_PATH', 'PARENT_SUMMARY', 'INSTITUTION_SUMMARY');

-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_instituteId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_instituteId_fkey";

-- DropIndex
DROP INDEX "students_instituteId_idx";

-- DropIndex
DROP INDEX "users_instituteId_idx";

-- AlterTable
ALTER TABLE "students" DROP COLUMN "instituteId",
ADD COLUMN     "projectId" TEXT NOT NULL,
ADD COLUMN     "studentCode" TEXT NOT NULL,
ADD COLUMN     "whatsappNumber" TEXT,
ADD COLUMN     "workflowStatus" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "instituteId",
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counsellors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counsellors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_counsellors" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_counsellors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counsellor_availability" (
    "id" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "daysOfWeek" "Weekday"[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counsellor_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "sessionNumber" "SessionNumber" NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "cancellationReason" "CancellationReason",
    "cancellationNotes" TEXT,
    "rescheduledFromDate" DATE,
    "rescheduledFromStart" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_library_entries" (
    "id" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "jobRole" TEXT NOT NULL,
    "aiResilienceGrade" "AiResilienceGrade" NOT NULL,
    "aiResilienceComment" TEXT NOT NULL,
    "oneLineDescription" TEXT NOT NULL,
    "topCompanies" TEXT[],
    "salaryIndiaMin" INTEGER NOT NULL,
    "salaryIndiaMax" INTEGER NOT NULL,
    "salaryGlobalMin" INTEGER NOT NULL,
    "salaryGlobalMax" INTEGER NOT NULL,
    "minimumQualification" TEXT NOT NULL,
    "entranceExams" TEXT[],
    "certifications" TEXT[],
    "topCourses" TEXT[],
    "status" "CareerLibraryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_library_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_library_requests" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "suggestedCluster" TEXT NOT NULL,
    "suggestedIndustry" TEXT NOT NULL,
    "suggestedDomain" TEXT,
    "oneLineDescription" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "referenceLinks" TEXT[],
    "status" "CareerRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resultingEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_library_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "formType" "FormType" NOT NULL,
    "cohort" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_questions" (
    "id" TEXT NOT NULL,
    "formTemplateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "form_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "formTemplateId" TEXT NOT NULL,
    "submittedByRole" "SubmittedByRole" NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_answers" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" JSONB NOT NULL,

    CONSTRAINT "form_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "trait" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AssessmentAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_answers" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOption" JSONB NOT NULL,

    CONSTRAINT "assessment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "traitScores" JSONB NOT NULL,
    "recommendedStreams" TEXT[],
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counsellor_charts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "strengths" TEXT[],
    "hobbies" TEXT[],
    "careerShortlist" TEXT[],
    "rawData" JSONB NOT NULL,
    "lastEditedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counsellor_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "generatedByCounsellorId" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_instituteId_idx" ON "projects"("instituteId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_instituteId_name_key" ON "projects"("instituteId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "counsellors_userId_key" ON "counsellors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "counsellors_mobile_key" ON "counsellors"("mobile");

-- CreateIndex
CREATE INDEX "counsellors_instituteId_idx" ON "counsellors"("instituteId");

-- CreateIndex
CREATE INDEX "project_counsellors_counsellorId_idx" ON "project_counsellors"("counsellorId");

-- CreateIndex
CREATE UNIQUE INDEX "project_counsellors_projectId_counsellorId_key" ON "project_counsellors"("projectId", "counsellorId");

-- CreateIndex
CREATE INDEX "counsellor_availability_counsellorId_idx" ON "counsellor_availability"("counsellorId");

-- CreateIndex
CREATE INDEX "counsellor_availability_projectId_idx" ON "counsellor_availability"("projectId");

-- CreateIndex
CREATE INDEX "sessions_studentId_idx" ON "sessions"("studentId");

-- CreateIndex
CREATE INDEX "sessions_counsellorId_idx" ON "sessions"("counsellorId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_studentId_sessionNumber_key" ON "sessions"("studentId", "sessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_counsellorId_scheduledDate_startTime_key" ON "sessions"("counsellorId", "scheduledDate", "startTime");

-- CreateIndex
CREATE INDEX "career_library_entries_cluster_idx" ON "career_library_entries"("cluster");

-- CreateIndex
CREATE INDEX "career_library_entries_industry_idx" ON "career_library_entries"("industry");

-- CreateIndex
CREATE INDEX "career_library_entries_domain_idx" ON "career_library_entries"("domain");

-- CreateIndex
CREATE INDEX "career_library_requests_requestedById_idx" ON "career_library_requests"("requestedById");

-- CreateIndex
CREATE INDEX "career_library_requests_status_idx" ON "career_library_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_formType_cohort_version_key" ON "form_templates"("formType", "cohort", "version");

-- CreateIndex
CREATE INDEX "form_questions_formTemplateId_idx" ON "form_questions"("formTemplateId");

-- CreateIndex
CREATE INDEX "form_submissions_studentId_idx" ON "form_submissions"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_studentId_formTemplateId_submittedByRole_key" ON "form_submissions"("studentId", "formTemplateId", "submittedByRole");

-- CreateIndex
CREATE UNIQUE INDEX "form_answers_submissionId_questionId_key" ON "form_answers"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "assessment_questions_cohort_idx" ON "assessment_questions"("cohort");

-- CreateIndex
CREATE INDEX "assessment_attempts_studentId_idx" ON "assessment_attempts"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_answers_attemptId_questionId_key" ON "assessment_answers"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_attemptId_key" ON "assessment_results"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "counsellor_charts_studentId_key" ON "counsellor_charts"("studentId");

-- CreateIndex
CREATE INDEX "reports_studentId_idx" ON "reports"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "students_studentCode_key" ON "students"("studentCode");

-- CreateIndex
CREATE INDEX "students_projectId_idx" ON "students"("projectId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellors" ADD CONSTRAINT "counsellors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellors" ADD CONSTRAINT "counsellors_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_counsellors" ADD CONSTRAINT "project_counsellors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_counsellors" ADD CONSTRAINT "project_counsellors_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "counsellors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellor_availability" ADD CONSTRAINT "counsellor_availability_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "counsellors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellor_availability" ADD CONSTRAINT "counsellor_availability_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "counsellors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_library_requests" ADD CONSTRAINT "career_library_requests_resultingEntryId_fkey" FOREIGN KEY ("resultingEntryId") REFERENCES "career_library_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_questions" ADD CONSTRAINT "form_questions_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "form_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellor_charts" ADD CONSTRAINT "counsellor_charts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

