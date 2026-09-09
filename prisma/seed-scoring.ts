// Loads the assessment scoring engine's reference/weightage data + counsellor-chart
// SCRI/alignment guidance text from prisma/seed-data/assessment-scoring/ (produced by
// scripts/export-assessment-scoring.py from the "Traits & Weightages" workbook) into
// the DB tables the engine now reads at runtime (see
// src/modules/assessment/scoring/data/store.ts).
//
// Run:  pnpm db:seed:scoring
//
// Idempotent: every table upserts on its unique key, so re-running (e.g. after the
// workbook changes and the export script is rerun) updates existing rows in place.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DATA_DIR = join(import.meta.dirname, "seed-data", "assessment-scoring");

// Workbook layer labels -> AssessmentSection enum values.
const LAYER_TO_SECTION: Record<string, string> = {
  RIASEC: "RIASEC",
  "Big FIVE": "BIG_FIVE",
  Aptitude: "APTITUDE",
  "Cognitive & Decision": "COGNITIVE",
};

function toSection(layer: string): string {
  const section = LAYER_TO_SECTION[layer];
  if (!section) throw new Error(`Unmapped trait-definition layer: ${layer}`);
  return section;
}

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

interface TraitDefinitionRow {
  layer: string;
  key: string;
  trait: string;
  traitName: string;
  description: string;
  studentQuality: string;
  studentFriendlyExplanation: string | null;
}

interface RiasecStyleRow {
  code: string;
  traits: string[];
  style: string;
  description: string;
  explanation: string;
}

interface BigFiveStyleRow {
  code: string;
  style: string;
  description: string;
  explanation: string;
}

interface StreamWeightRow {
  mainStream: string;
  subStream: string;
  coreSubjects: string | null;
  electiveSubjects: string | null;
  explanation: string | null;
  weights: Record<string, number>;
}

interface DomainWeightRow {
  cluster: string;
  industry: string;
  domain: string;
  weightSum: number;
  explanation: string | null;
  weights: Record<string, number>;
}

interface GraduateStreamWeightRow {
  clusterHead: string | null;
  mainStream: string;
  subStream: string;
  specialisations: string | null;
  eligibility: string | null;
  keyExams: string | null;
  explanation: string | null;
  weights: Record<string, number>;
}

interface ReliabilityMeasureRow {
  code: string;
  measure: string;
  friendlyName: string;
  whatItMeasures: string;
}

interface ScriBandRow {
  band: number;
  scoreRange: string;
  label: string;
  labelMeaning: string;
  forStudents: string;
  tipsForStudents: string;
  tipsForParent: string;
}

interface AlignmentGuidanceRow {
  rating: string;
  label: string;
  studentNote: string;
}

export async function seedScoringReferenceData(): Promise<void> {
  const traitDefinitions = readJson<TraitDefinitionRow[]>("trait-definitions.json");
  for (const t of traitDefinitions) {
    const layer = toSection(t.layer);
    await prisma.assessmentTraitDefinition.upsert({
      where: { key: t.key },
      update: {
        layer: layer as never,
        trait: t.trait,
        traitName: t.traitName,
        description: t.description,
        studentQuality: t.studentQuality,
        studentFriendlyExplanation: t.studentFriendlyExplanation,
      },
      create: {
        layer: layer as never,
        key: t.key,
        trait: t.trait,
        traitName: t.traitName,
        description: t.description,
        studentQuality: t.studentQuality,
        studentFriendlyExplanation: t.studentFriendlyExplanation,
      },
    });
  }
  console.log(`  assessment_trait_definitions: ${traitDefinitions.length}`);

  const riasec = readJson<RiasecStyleRow[]>("riasec-120.json");
  for (const r of riasec) {
    await prisma.riasecStyle.upsert({
      where: { code: r.code },
      update: { traits: r.traits, style: r.style, description: r.description, explanation: r.explanation },
      create: { code: r.code, traits: r.traits, style: r.style, description: r.description, explanation: r.explanation },
    });
  }
  console.log(`  riasec_styles: ${riasec.length}`);

  const bigFive = readJson<BigFiveStyleRow[]>("bigfive-20.json");
  for (const b of bigFive) {
    await prisma.bigFiveStyle.upsert({
      where: { code: b.code },
      update: { style: b.style, description: b.description, explanation: b.explanation },
      create: { code: b.code, style: b.style, description: b.description, explanation: b.explanation },
    });
  }
  console.log(`  bigfive_styles: ${bigFive.length}`);

  const streamWeights = readJson<StreamWeightRow[]>("stream-weights.json");
  for (const s of streamWeights) {
    await prisma.streamWeight.upsert({
      where: { mainStream_subStream: { mainStream: s.mainStream, subStream: s.subStream } },
      update: {
        coreSubjects: s.coreSubjects,
        electiveSubjects: s.electiveSubjects,
        explanation: s.explanation,
        weights: s.weights,
      },
      create: {
        mainStream: s.mainStream,
        subStream: s.subStream,
        coreSubjects: s.coreSubjects,
        electiveSubjects: s.electiveSubjects,
        explanation: s.explanation,
        weights: s.weights,
      },
    });
  }
  console.log(`  stream_weights: ${streamWeights.length}`);

  const domainWeights = readJson<DomainWeightRow[]>("domain-weights.json");
  for (const d of domainWeights) {
    await prisma.domainWeight.upsert({
      where: { industry_domain: { industry: d.industry, domain: d.domain } },
      update: { cluster: d.cluster, weightSum: d.weightSum, explanation: d.explanation, weights: d.weights },
      create: {
        cluster: d.cluster,
        industry: d.industry,
        domain: d.domain,
        weightSum: d.weightSum,
        explanation: d.explanation,
        weights: d.weights,
      },
    });
  }
  console.log(`  domain_weights: ${domainWeights.length}`);

  const graduateStreams = readJson<GraduateStreamWeightRow[]>("graduate-streams.json");
  for (const g of graduateStreams) {
    await prisma.graduateStreamWeight.upsert({
      where: { mainStream_subStream: { mainStream: g.mainStream, subStream: g.subStream } },
      update: {
        clusterHead: g.clusterHead,
        specialisations: g.specialisations,
        eligibility: g.eligibility,
        keyExams: g.keyExams,
        explanation: g.explanation,
        weights: g.weights,
      },
      create: {
        clusterHead: g.clusterHead,
        mainStream: g.mainStream,
        subStream: g.subStream,
        specialisations: g.specialisations,
        eligibility: g.eligibility,
        keyExams: g.keyExams,
        explanation: g.explanation,
        weights: g.weights,
      },
    });
  }
  console.log(`  graduate_stream_weights: ${graduateStreams.length}`);

  const reliabilityMeasures = readJson<ReliabilityMeasureRow[]>("reliability-measures.json");
  for (const m of reliabilityMeasures) {
    await prisma.reliabilityMeasureDefinition.upsert({
      where: { code: m.code },
      update: { measure: m.measure, friendlyName: m.friendlyName, whatItMeasures: m.whatItMeasures },
      create: { code: m.code, measure: m.measure, friendlyName: m.friendlyName, whatItMeasures: m.whatItMeasures },
    });
  }
  console.log(`  reliability_measure_definitions: ${reliabilityMeasures.length}`);

  const scriBands = readJson<ScriBandRow[]>("scri-band-guidance.json");
  for (const b of scriBands) {
    await prisma.scriBandGuidance.upsert({
      where: { band: b.band },
      update: {
        scoreRange: b.scoreRange,
        label: b.label,
        labelMeaning: b.labelMeaning,
        forStudents: b.forStudents,
        tipsForStudents: b.tipsForStudents,
        tipsForParent: b.tipsForParent,
      },
      create: {
        band: b.band,
        scoreRange: b.scoreRange,
        label: b.label,
        labelMeaning: b.labelMeaning,
        forStudents: b.forStudents,
        tipsForStudents: b.tipsForStudents,
        tipsForParent: b.tipsForParent,
      },
    });
  }
  console.log(`  scri_band_guidance: ${scriBands.length}`);

  const alignmentGuidance = readJson<AlignmentGuidanceRow[]>("alignment-rating-guidance.json");
  for (const a of alignmentGuidance) {
    await prisma.alignmentRatingGuidance.upsert({
      where: { rating: a.rating as never },
      update: { label: a.label, studentNote: a.studentNote },
      create: { rating: a.rating as never, label: a.label, studentNote: a.studentNote },
    });
  }
  console.log(`  alignment_rating_guidance: ${alignmentGuidance.length}`);
}

const invokedDirectly = process.argv[1]?.includes("seed-scoring");
if (invokedDirectly) {
  seedScoringReferenceData()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
