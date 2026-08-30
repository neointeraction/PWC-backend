-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submittedBy" TEXT;

-- AlterTable
ALTER TABLE "domain_education_entries" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submittedBy" TEXT;

-- AlterTable
ALTER TABLE "entrance_exams" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submittedBy" TEXT;

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submittedBy" TEXT;

-- CreateIndex
CREATE INDEX "courses_status_idx" ON "courses"("status");

-- CreateIndex
CREATE INDEX "domain_education_entries_status_idx" ON "domain_education_entries"("status");

-- CreateIndex
CREATE INDEX "entrance_exams_status_idx" ON "entrance_exams"("status");

-- CreateIndex
CREATE INDEX "institutions_status_idx" ON "institutions"("status");
