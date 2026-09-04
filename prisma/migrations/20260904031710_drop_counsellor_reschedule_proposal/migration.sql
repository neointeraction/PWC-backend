/*
  Warnings:

  - You are about to drop the column `counsellorProposedDate` on the `sessions` table. All the data in the column will be lost.
  - You are about to drop the column `counsellorProposedEndTime` on the `sessions` table. All the data in the column will be lost.
  - You are about to drop the column `counsellorProposedStartTime` on the `sessions` table. All the data in the column will be lost.
  - You are about to drop the column `counsellorRescheduleReason` on the `sessions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "counsellorProposedDate",
DROP COLUMN "counsellorProposedEndTime",
DROP COLUMN "counsellorProposedStartTime",
DROP COLUMN "counsellorRescheduleReason";
