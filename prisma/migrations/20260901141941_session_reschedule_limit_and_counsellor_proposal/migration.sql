-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "counsellorProposedDate" DATE,
ADD COLUMN     "counsellorProposedEndTime" TEXT,
ADD COLUMN     "counsellorProposedStartTime" TEXT,
ADD COLUMN     "counsellorRescheduleReason" TEXT,
ADD COLUMN     "studentRescheduleUsed" BOOLEAN NOT NULL DEFAULT false;
