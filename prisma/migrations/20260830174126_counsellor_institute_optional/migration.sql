-- DropForeignKey
ALTER TABLE "counsellors" DROP CONSTRAINT "counsellors_instituteId_fkey";

-- AlterTable
ALTER TABLE "counsellors" ALTER COLUMN "instituteId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "counsellors" ADD CONSTRAINT "counsellors_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "institutes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
