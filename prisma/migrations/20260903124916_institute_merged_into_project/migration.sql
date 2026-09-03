-- AlterTable: add the new Project columns as nullable first so existing rows can be
-- backfilled from the institute they point to before we enforce NOT NULL.
ALTER TABLE "projects" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactNumber" TEXT,
ADD COLUMN     "primaryEmail" TEXT;

UPDATE "projects" p
SET "address" = i."address",
    "contactNumber" = i."contactNumber",
    "primaryEmail" = i."primaryEmail"
FROM "institutes" i
WHERE i."id" = p."instituteId";

-- Any project left without an institute (shouldn't happen given the FK was NOT NULL) falls
-- back to empty string, matching the "" convention the old Institute model used for optional
-- contact fields.
UPDATE "projects" SET "address" = '' WHERE "address" IS NULL;
UPDATE "projects" SET "contactNumber" = '' WHERE "contactNumber" IS NULL;
UPDATE "projects" SET "primaryEmail" = '' WHERE "primaryEmail" IS NULL;

ALTER TABLE "projects" ALTER COLUMN "address" SET NOT NULL,
ALTER COLUMN "contactNumber" SET NOT NULL,
ALTER COLUMN "primaryEmail" SET NOT NULL;

-- AlterTable: same treatment for Student.className/divisionName, backfilled from the
-- institute_divisions/institute_classes hierarchy via the old divisionId.
ALTER TABLE "students" ADD COLUMN     "className" TEXT,
ADD COLUMN     "divisionName" TEXT;

UPDATE "students" s
SET "className" = ic."name",
    "divisionName" = id."name"
FROM "institute_divisions" id
JOIN "institute_classes" ic ON ic."id" = id."classId"
WHERE id."id" = s."divisionId";

UPDATE "students" SET "className" = '' WHERE "className" IS NULL;
UPDATE "students" SET "divisionName" = '' WHERE "divisionName" IS NULL;

ALTER TABLE "students" ALTER COLUMN "className" SET NOT NULL,
ALTER COLUMN "divisionName" SET NOT NULL;

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
ALTER TABLE "projects" DROP COLUMN "instituteId";

-- AlterTable
ALTER TABLE "students" DROP COLUMN "divisionId";

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
