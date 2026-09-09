-- AlterTable
ALTER TABLE "counsellor_charts" ADD COLUMN     "careerCompassClusterTable" JSONB,
ADD COLUMN     "careerCompassTable" JSONB,
ADD COLUMN     "collegesTable" JSONB,
ADD COLUMN     "entranceExamsTable" JSONB,
ADD COLUMN     "graduationTable" JSONB,
ADD COLUMN     "streamFitTable" JSONB;
