// In-memory cache of the scoring engine's reference/weightage data. The DB (9 tables,
// see prisma/schema.prisma "AssessmentTraitDefinition ... AlignmentRatingGuidance") is
// the source of truth; loadScoringReferenceData() reads it once (call at process
// startup — see src/server.ts) so the engine itself (dcs.ts, dps.ts, streamFit.ts,
// careerFit.ts, graduationFit.ts, index.ts) can stay synchronous and pure, matching its
// existing design (see index.ts header comment) and its DB-free unit test suite
// (test/assessment-scoring.test.ts).

import { prisma } from "../../../../config/prisma.js";
import type { TraitKey } from "../types.js";
import type {
  AlignmentRatingGuidance,
  BigFive20Entry,
  DomainWeightEntry,
  GraduateStreamEntry,
  ReliabilityMeasureDefinition,
  Riasec120Entry,
  ScriBandGuidance,
  StreamWeightEntry,
  TraitDefinition,
} from "./types.js";

interface ScoringDataCache {
  traitDefinitions: TraitDefinition[];
  riasec120: Riasec120Entry[];
  bigFive20: BigFive20Entry[];
  streamWeights: StreamWeightEntry[];
  domainWeights: DomainWeightEntry[];
  graduateStreams: GraduateStreamEntry[];
  reliabilityMeasures: ReliabilityMeasureDefinition[];
  scriBands: ScriBandGuidance[];
  alignmentGuidance: AlignmentRatingGuidance[];
}

let cache: ScoringDataCache | null = null;

export async function loadScoringReferenceData(): Promise<void> {
  const [
    traitDefinitionRows,
    riasecRows,
    bigFiveRows,
    streamRows,
    domainRows,
    graduateRows,
    reliabilityRows,
    scriBandRows,
    alignmentRows,
  ] = await Promise.all([
    prisma.assessmentTraitDefinition.findMany(),
    prisma.riasecStyle.findMany(),
    prisma.bigFiveStyle.findMany(),
    prisma.streamWeight.findMany(),
    prisma.domainWeight.findMany(),
    prisma.graduateStreamWeight.findMany(),
    prisma.reliabilityMeasureDefinition.findMany(),
    prisma.scriBandGuidance.findMany(),
    prisma.alignmentRatingGuidance.findMany(),
  ]);

  cache = {
    traitDefinitions: traitDefinitionRows.map((r) => ({
      layer: r.layer,
      key: r.key as TraitKey,
      trait: r.trait,
      traitName: r.traitName,
      description: r.description,
      studentQuality: r.studentQuality,
      studentFriendlyExplanation: r.studentFriendlyExplanation,
    })),
    riasec120: riasecRows.map((r) => ({
      code: r.code,
      traits: r.traits as TraitKey[],
      style: r.style,
      description: r.description,
      explanation: r.explanation,
    })),
    bigFive20: bigFiveRows.map((r) => ({
      code: r.code,
      style: r.style,
      description: r.description,
      explanation: r.explanation,
    })),
    streamWeights: streamRows.map((r) => ({
      mainStream: r.mainStream,
      subStream: r.subStream,
      coreSubjects: r.coreSubjects,
      electiveSubjects: r.electiveSubjects,
      explanation: r.explanation,
      weights: r.weights as Partial<Record<TraitKey, number>>,
    })),
    domainWeights: domainRows.map((r) => ({
      cluster: r.cluster,
      industry: r.industry,
      domain: r.domain,
      weightSum: r.weightSum,
      explanation: r.explanation,
      weights: r.weights as Partial<Record<TraitKey, number>>,
    })),
    graduateStreams: graduateRows.map((r) => ({
      clusterHead: r.clusterHead,
      mainStream: r.mainStream,
      subStream: r.subStream,
      specialisations: r.specialisations,
      eligibility: r.eligibility,
      keyExams: r.keyExams,
      explanation: r.explanation,
      weights: r.weights as Partial<Record<TraitKey, number>>,
    })),
    reliabilityMeasures: reliabilityRows.map((r) => ({
      code: r.code,
      measure: r.measure,
      friendlyName: r.friendlyName,
      whatItMeasures: r.whatItMeasures,
    })),
    scriBands: scriBandRows.map((r) => ({
      band: r.band,
      scoreRange: r.scoreRange,
      label: r.label,
      labelMeaning: r.labelMeaning,
      forStudents: r.forStudents,
      tipsForStudents: r.tipsForStudents,
      tipsForParent: r.tipsForParent,
    })),
    alignmentGuidance: alignmentRows.map((r) => ({
      rating: r.rating,
      label: r.label,
      studentNote: r.studentNote,
    })),
  };
}

function getCache(): ScoringDataCache {
  if (!cache) {
    throw new Error(
      "Scoring reference data not loaded — call loadScoringReferenceData() at startup before using the scoring engine"
    );
  }
  return cache;
}

export const scoringData = {
  get traitDefinitions() {
    return getCache().traitDefinitions;
  },
  get riasec120() {
    return getCache().riasec120;
  },
  get bigFive20() {
    return getCache().bigFive20;
  },
  get streamWeights() {
    return getCache().streamWeights;
  },
  get domainWeights() {
    return getCache().domainWeights;
  },
  get graduateStreams() {
    return getCache().graduateStreams;
  },
  get reliabilityMeasures() {
    return getCache().reliabilityMeasures;
  },
  get scriBands() {
    return getCache().scriBands;
  },
  get alignmentGuidance() {
    return getCache().alignmentGuidance;
  },
};
