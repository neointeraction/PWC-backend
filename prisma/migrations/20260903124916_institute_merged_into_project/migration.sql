-- DropForeignKey
ALTER TABLE "counsellors" DROP CONSTRAINT "counsellors_instituteId_fkey";

-- DropForeignKey
ALTER TABLE "institute_classes" DROP CONSTRAINT "institute_classes_instituteId_fkey";

-- DropForeignKey
ALTER TABLE "institute_divisions" DROP CONSTRAINT "institute_divisions_classId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_instituteId_fkey";

-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_divisionId_fkey";

-- DropIndex
DROP INDEX "counsellors_instituteId_idx";

-- DropIndex
DROP INDEX "projects_instituteId_idx";

-- DropIndex
DROP INDEX "projects_instituteId_name_key";

-- DropIndex
DROP INDEX "students_divisionId_idx";

-- AlterTable
ALTER TABLE "counsellors" DROP COLUMN "instituteId";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "instituteId",
ADD COLUMN     "address" TEXT NOT NULL,
ADD COLUMN     "contactNumber" TEXT NOT NULL,
ADD COLUMN     "primaryEmail" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "students" DROP COLUMN "divisionId",
ADD COLUMN     "className" TEXT NOT NULL,
ADD COLUMN     "divisionName" TEXT NOT NULL;

-- DropTable
DROP TABLE "institute_classes";

-- DropTable
DROP TABLE "institute_divisions";

-- DropTable
DROP TABLE "institutes";

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_contactNumber_key" ON "projects"("contactNumber");

-- CreateIndex
CREATE UNIQUE INDEX "projects_primaryEmail_key" ON "projects"("primaryEmail");

