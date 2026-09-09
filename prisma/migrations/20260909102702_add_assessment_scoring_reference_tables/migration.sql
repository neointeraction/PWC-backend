-- CreateTable
CREATE TABLE "assessment_trait_definitions" (
    "id" TEXT NOT NULL,
    "layer" "AssessmentSection" NOT NULL,
    "key" TEXT NOT NULL,
    "trait" TEXT NOT NULL,
    "traitName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "studentQuality" TEXT NOT NULL,
    "studentFriendlyExplanation" TEXT,

    CONSTRAINT "assessment_trait_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riasec_styles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "traits" TEXT[],
    "style" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "riasec_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bigfive_styles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "bigfive_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_weights" (
    "id" TEXT NOT NULL,
    "mainStream" TEXT NOT NULL,
    "subStream" TEXT NOT NULL,
    "coreSubjects" TEXT,
    "electiveSubjects" TEXT,
    "explanation" TEXT,
    "weights" JSONB NOT NULL,

    CONSTRAINT "stream_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_weights" (
    "id" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "weightSum" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT,
    "weights" JSONB NOT NULL,

    CONSTRAINT "domain_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graduate_stream_weights" (
    "id" TEXT NOT NULL,
    "clusterHead" TEXT,
    "mainStream" TEXT NOT NULL,
    "subStream" TEXT NOT NULL,
    "specialisations" TEXT,
    "eligibility" TEXT,
    "keyExams" TEXT,
    "explanation" TEXT,
    "weights" JSONB NOT NULL,

    CONSTRAINT "graduate_stream_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reliability_measure_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "friendlyName" TEXT NOT NULL,
    "whatItMeasures" TEXT NOT NULL,

    CONSTRAINT "reliability_measure_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scri_band_guidance" (
    "id" TEXT NOT NULL,
    "band" INTEGER NOT NULL,
    "scoreRange" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelMeaning" TEXT NOT NULL,
    "forStudents" TEXT NOT NULL,
    "tipsForStudents" TEXT NOT NULL,
    "tipsForParent" TEXT NOT NULL,

    CONSTRAINT "scri_band_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alignment_rating_guidance" (
    "id" TEXT NOT NULL,
    "rating" "AlignmentRating" NOT NULL,
    "label" TEXT NOT NULL,
    "studentNote" TEXT NOT NULL,

    CONSTRAINT "alignment_rating_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_trait_definitions_key_key" ON "assessment_trait_definitions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "riasec_styles_code_key" ON "riasec_styles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bigfive_styles_code_key" ON "bigfive_styles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stream_weights_mainStream_subStream_key" ON "stream_weights"("mainStream", "subStream");

-- CreateIndex
CREATE INDEX "domain_weights_cluster_idx" ON "domain_weights"("cluster");

-- CreateIndex
CREATE UNIQUE INDEX "domain_weights_industry_domain_key" ON "domain_weights"("industry", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "graduate_stream_weights_mainStream_subStream_key" ON "graduate_stream_weights"("mainStream", "subStream");

-- CreateIndex
CREATE UNIQUE INDEX "reliability_measure_definitions_code_key" ON "reliability_measure_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "scri_band_guidance_band_key" ON "scri_band_guidance"("band");

-- CreateIndex
CREATE UNIQUE INDEX "alignment_rating_guidance_rating_key" ON "alignment_rating_guidance"("rating");
