-- DropForeignKey
ALTER TABLE "career_library_requests" DROP CONSTRAINT "career_library_requests_resultingEntryId_fkey";

-- DropTable
DROP TABLE "career_library_requests";

-- DropEnum
DROP TYPE "CareerRequestStatus";

