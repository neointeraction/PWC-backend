-- CreateEnum
CREATE TYPE "EducationPathLevel" AS ENUM ('CLASS_10_PLUS_2', 'GRADUATE', 'POST_GRADUATE', 'CERTIFICATION_STUDENT', 'CERTIFICATION_UG');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "furtherStudyOptions" TEXT,
ADD COLUMN     "programmesOffered" TEXT,
ADD COLUMN     "relevantEntranceExams" TEXT,
ADD COLUMN     "stream12thRequirements" TEXT,
ADD COLUMN     "topColleges" TEXT;

-- AlterTable
ALTER TABLE "entrance_exams" ADD COLUMN     "applicableFor" TEXT,
ADD COLUMN     "applicationWindow" TEXT,
ADD COLUMN     "examMode" TEXT,
ADD COLUMN     "frequency" TEXT,
ADD COLUMN     "subjectRequirements12th" TEXT;

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "entranceExamsRequired" TEXT,
ADD COLUMN     "programmesOffered" TEXT,
ADD COLUMN     "ranking" TEXT,
ADD COLUMN     "shortName" TEXT;

-- CreateTable
CREATE TABLE "domain_education_entries" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "level" "EducationPathLevel" NOT NULL,
    "programme" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_education_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_education_entries" (
    "careerEntryId" TEXT NOT NULL,
    "educationEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_education_entries_pkey" PRIMARY KEY ("careerEntryId","educationEntryId")
);

-- CreateIndex
CREATE INDEX "domain_education_entries_domainId_idx" ON "domain_education_entries"("domainId");

-- CreateIndex
CREATE INDEX "career_education_entries_educationEntryId_idx" ON "career_education_entries"("educationEntryId");

-- AddForeignKey
ALTER TABLE "domain_education_entries" ADD CONSTRAINT "domain_education_entries_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "career_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_education_entries" ADD CONSTRAINT "career_education_entries_careerEntryId_fkey" FOREIGN KEY ("careerEntryId") REFERENCES "career_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_education_entries" ADD CONSTRAINT "career_education_entries_educationEntryId_fkey" FOREIGN KEY ("educationEntryId") REFERENCES "domain_education_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
