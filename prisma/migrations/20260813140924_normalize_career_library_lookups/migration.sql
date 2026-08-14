-- CreateEnum
CREATE TYPE "QualificationLevel" AS ENUM ('UG', 'PG');

-- CreateTable
CREATE TABLE "entrance_exams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "QualificationLevel" NOT NULL,
    "fullForm" TEXT,
    "conductingBody" TEXT,
    "officialWebsite" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entrance_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "type" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "QualificationLevel" NOT NULL,
    "fullForm" TEXT,
    "durationYears" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_entrance_exams" (
    "careerEntryId" TEXT NOT NULL,
    "entranceExamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_entrance_exams_pkey" PRIMARY KEY ("careerEntryId","entranceExamId")
);

-- CreateTable
CREATE TABLE "career_institutions" (
    "careerEntryId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_institutions_pkey" PRIMARY KEY ("careerEntryId","institutionId")
);

-- CreateTable
CREATE TABLE "career_courses" (
    "careerEntryId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_courses_pkey" PRIMARY KEY ("careerEntryId","courseId")
);

-- CreateIndex
CREATE INDEX "entrance_exams_name_idx" ON "entrance_exams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "entrance_exams_name_level_key" ON "entrance_exams"("name", "level");

-- CreateIndex
CREATE UNIQUE INDEX "institutions_name_key" ON "institutions"("name");

-- CreateIndex
CREATE INDEX "institutions_name_idx" ON "institutions"("name");

-- CreateIndex
CREATE INDEX "courses_name_idx" ON "courses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "courses_name_level_key" ON "courses"("name", "level");

-- CreateIndex
CREATE INDEX "career_entrance_exams_entranceExamId_idx" ON "career_entrance_exams"("entranceExamId");

-- CreateIndex
CREATE INDEX "career_institutions_institutionId_idx" ON "career_institutions"("institutionId");

-- CreateIndex
CREATE INDEX "career_courses_courseId_idx" ON "career_courses"("courseId");

-- AddForeignKey
ALTER TABLE "career_entrance_exams" ADD CONSTRAINT "career_entrance_exams_careerEntryId_fkey" FOREIGN KEY ("careerEntryId") REFERENCES "career_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_entrance_exams" ADD CONSTRAINT "career_entrance_exams_entranceExamId_fkey" FOREIGN KEY ("entranceExamId") REFERENCES "entrance_exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_institutions" ADD CONSTRAINT "career_institutions_careerEntryId_fkey" FOREIGN KEY ("careerEntryId") REFERENCES "career_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_institutions" ADD CONSTRAINT "career_institutions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_courses" ADD CONSTRAINT "career_courses_careerEntryId_fkey" FOREIGN KEY ("careerEntryId") REFERENCES "career_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_courses" ADD CONSTRAINT "career_courses_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
