/*
  Warnings:

  - You are about to drop the `counsellor_availability` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'BOOKED');

-- DropForeignKey
ALTER TABLE "counsellor_availability" DROP CONSTRAINT "counsellor_availability_counsellorId_fkey";

-- DropForeignKey
ALTER TABLE "counsellor_availability" DROP CONSTRAINT "counsellor_availability_projectId_fkey";

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "counsellorJoinedAt" TIMESTAMP(3),
ADD COLUMN     "counsellorNoShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "meetingLink" TEXT,
ADD COLUMN     "studentJoinedAt" TIMESTAMP(3),
ADD COLUMN     "studentNoShow" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "counsellor_availability";

-- DropEnum
DROP TYPE "Weekday";

-- CreateTable
CREATE TABLE "counsellor_slots" (
    "id" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slotDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counsellor_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "counsellor_slots_sessionId_key" ON "counsellor_slots"("sessionId");

-- CreateIndex
CREATE INDEX "counsellor_slots_projectId_slotDate_startTime_idx" ON "counsellor_slots"("projectId", "slotDate", "startTime");

-- CreateIndex
CREATE INDEX "counsellor_slots_counsellorId_status_idx" ON "counsellor_slots"("counsellorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "counsellor_slots_counsellorId_slotDate_startTime_key" ON "counsellor_slots"("counsellorId", "slotDate", "startTime");

-- AddForeignKey
ALTER TABLE "counsellor_slots" ADD CONSTRAINT "counsellor_slots_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "counsellors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellor_slots" ADD CONSTRAINT "counsellor_slots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counsellor_slots" ADD CONSTRAINT "counsellor_slots_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
