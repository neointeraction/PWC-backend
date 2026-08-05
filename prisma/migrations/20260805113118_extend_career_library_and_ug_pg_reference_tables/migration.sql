-- AlterTable
ALTER TABLE "career_library_entries" DROP COLUMN "certifications",
DROP COLUMN "minimumQualification",
DROP COLUMN "salaryGlobalMax",
DROP COLUMN "salaryGlobalMin",
DROP COLUMN "salaryIndiaMax",
DROP COLUMN "salaryIndiaMin",
ADD COLUMN     "certificationsStudent" TEXT[],
ADD COLUMN     "certificationsUG" TEXT[],
ADD COLUMN     "entranceExamsPG" TEXT[],
ADD COLUMN     "entranceExamsUGDescription" TEXT,
ADD COLUMN     "qualification10th12th" TEXT NOT NULL,
ADD COLUMN     "qualificationGraduation" TEXT,
ADD COLUMN     "qualificationPG" TEXT,
ADD COLUMN     "salaryGlobalMaxUSD" DOUBLE PRECISION,
ADD COLUMN     "salaryGlobalMinUSD" DOUBLE PRECISION,
ADD COLUMN     "salaryGlobalRangeText" TEXT,
ADD COLUMN     "salaryIndiaMaxLPA" DOUBLE PRECISION,
ADD COLUMN     "salaryIndiaMinLPA" DOUBLE PRECISION,
ADD COLUMN     "salaryIndiaRangeText" TEXT;

-- CreateTable
CREATE TABLE "ug_institutions" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "shortName" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "type" TEXT,
    "category" TEXT,
    "programmesOffered" TEXT,
    "programmesOfferedAfterClass12" TEXT,
    "keyProgrammesOffered" TEXT,
    "primaryEntranceExams" TEXT,
    "nirfRanking" TEXT,
    "otherRankings" TEXT,
    "approxAnnualFee" TEXT,
    "approxPlacementCtc" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ug_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ug_institutions_universities" (
    "id" TEXT NOT NULL,
    "shortName" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "type" TEXT,
    "category" TEXT,
    "keyProgrammesOffered" TEXT,
    "primaryEntranceExams" TEXT,
    "nirfRanking" TEXT,
    "otherRankings" TEXT,
    "approxAnnualFee" TEXT,
    "approxPlacementCtc" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ug_institutions_universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ug_entrance_exams" (
    "id" TEXT NOT NULL,
    "examName" TEXT NOT NULL,
    "fullForm" TEXT,
    "conductingBody" TEXT,
    "level" TEXT,
    "applicableFor" TEXT,
    "subjectRequirements12th" TEXT,
    "applicationWindow" TEXT,
    "examMonth" TEXT,
    "resultMonth" TEXT,
    "examMode" TEXT,
    "frequency" TEXT,
    "approxAttemptsAllowed" TEXT,
    "officialWebsite" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ug_entrance_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ug_courses" (
    "id" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "fullForm" TEXT,
    "level" TEXT,
    "durationYears" TEXT,
    "careerCluster" TEXT NOT NULL,
    "stream12thRequirements" TEXT,
    "minimumEligibility" TEXT,
    "entranceExamsPrimary" TEXT,
    "entranceExamsAlternate" TEXT,
    "topSpecialisations" TEXT,
    "topGovtColleges" TEXT,
    "topPrivateColleges" TEXT,
    "approxAnnualFeeRange" TEXT,
    "furtherStudyOptions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ug_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pg_institutions" (
    "id" TEXT NOT NULL,
    "industry" TEXT,
    "institution" TEXT NOT NULL,
    "state" TEXT,
    "city" TEXT,
    "programTypes" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pg_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pg_entrance_exams" (
    "id" TEXT NOT NULL,
    "examName" TEXT NOT NULL,
    "coursesForExam" TEXT,
    "officialWebsite" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pg_entrance_exams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ug_institutions_industry_idx" ON "ug_institutions"("industry");

-- CreateIndex
CREATE INDEX "ug_institutions_name_idx" ON "ug_institutions"("name");

-- CreateIndex
CREATE INDEX "ug_institutions_universities_name_idx" ON "ug_institutions_universities"("name");

-- CreateIndex
CREATE INDEX "ug_entrance_exams_examName_idx" ON "ug_entrance_exams"("examName");

-- CreateIndex
CREATE INDEX "ug_courses_careerCluster_idx" ON "ug_courses"("careerCluster");

-- CreateIndex
CREATE INDEX "pg_institutions_industry_idx" ON "pg_institutions"("industry");

-- CreateIndex
CREATE INDEX "pg_institutions_institution_idx" ON "pg_institutions"("institution");

-- CreateIndex
CREATE INDEX "pg_entrance_exams_examName_idx" ON "pg_entrance_exams"("examName");

