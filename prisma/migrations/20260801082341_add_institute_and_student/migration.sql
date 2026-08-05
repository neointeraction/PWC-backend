-- AlterTable
ALTER TABLE "users" ADD COLUMN     "instituteId" TEXT;

-- CreateTable
CREATE TABLE "institutes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "primaryEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institute_classes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institute_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institute_divisions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institute_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "parentName" TEXT NOT NULL,
    "parentMobile" TEXT NOT NULL,
    "parentEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutes_name_key" ON "institutes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "institutes_contactNumber_key" ON "institutes"("contactNumber");

-- CreateIndex
CREATE UNIQUE INDEX "institutes_primaryEmail_key" ON "institutes"("primaryEmail");

-- CreateIndex
CREATE INDEX "institute_classes_instituteId_idx" ON "institute_classes"("instituteId");

-- CreateIndex
CREATE UNIQUE INDEX "institute_classes_instituteId_name_key" ON "institute_classes"("instituteId", "name");

-- CreateIndex
CREATE INDEX "institute_divisions_classId_idx" ON "institute_divisions"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "institute_divisions_classId_name_key" ON "institute_divisions"("classId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_mobile_key" ON "students"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "students_parentMobile_key" ON "students"("parentMobile");

-- CreateIndex
CREATE UNIQUE INDEX "students_parentEmail_key" ON "students"("parentEmail");

-- CreateIndex
CREATE INDEX "students_instituteId_idx" ON "students"("instituteId");

-- CreateIndex
CREATE INDEX "students_divisionId_idx" ON "students"("divisionId");

-- CreateIndex
CREATE INDEX "users_instituteId_idx" ON "users"("instituteId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "institutes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institute_classes" ADD CONSTRAINT "institute_classes_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institute_divisions" ADD CONSTRAINT "institute_divisions_classId_fkey" FOREIGN KEY ("classId") REFERENCES "institute_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "institute_divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
