-- AlterTable
ALTER TABLE "students" DROP COLUMN "parentName",
ADD COLUMN     "fatherEmployer" TEXT,
ADD COLUMN     "fatherName" TEXT NOT NULL,
ADD COLUMN     "fatherOccupation" TEXT NOT NULL,
ADD COLUMN     "motherEmployer" TEXT,
ADD COLUMN     "motherName" TEXT NOT NULL,
ADD COLUMN     "motherOccupation" TEXT NOT NULL;

