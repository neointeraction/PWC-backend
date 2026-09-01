-- AlterTable
ALTER TABLE "students" ADD COLUMN     "discontinuedAt" TIMESTAMP(3),
ADD COLUMN     "discontinuedReason" TEXT,
ADD COLUMN     "isDiscontinued" BOOLEAN NOT NULL DEFAULT false;
