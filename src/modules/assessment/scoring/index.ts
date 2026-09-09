// Assessment scoring engine — orchestrator.
//
// Pure over a normalized attempt (AnsweredQuestion[] + timing). Produces the full
// computed report backing the Career kREATE output. Everything is fully specified and
// computed here, with one exception:
//   - Time Consistency / composite ARI: needs per-question timing. Computed whenever
//     every aptitude answer carries a timeTakenMs; null (and listed in meta.pending)
//     otherwise.
// RVS (Response Validity Score) is implemented in ./rvs.ts — note it deliberately sums
// mirror-pair penalties rather than averaging them as the construct doc's formula reads
// literally, since averaging can't reach the doc's own grade bands (confirmed with PWC).
// Career Fit (top-6 domains + representative careers) is implemented in ./careerFit.ts.

import { scoreAptitude } from "./aptitude.js";
import { computeAci, type AciResult } from "./aci.js";
import { computeAri, type AriResult } from "./ari.js";
import { scoreBigFive } from "./bigfive.js";
import { scoreCareerFit, type CareerFitResult, type DomainUnit } from "./careerFit.js";
import { scoreCognitive } from "./cognitive.js";
import { resolveDominantCareerStyle, type DominantCareerStyle } from "./dcs.js";
import { resolveDominantPersonalityStyle, type DominantPersonalityStyle } from "./dps.js";
import { scoringData } from "./data/store.js";
import { scoreGraduationPathways, type GraduationFitResult } from "./graduationFit.js";
import { computeOri, type OriResult } from "./ori.js";
import { computeRvs, type RvsResult } from "./rvs.js";
import { scoreRiasec } from "./riasec.js";
import { scoreStreamFit, type StreamFitResult, type TraitScoreMap } from "./streamFit.js";
import type { AnsweredQuestion, Layer, TraitKey, TraitScore } from "./types.js";

// A trait score enriched with its report-facing name and description.
export interface EnrichedTraitScore extends TraitScore {
  layer: Layer;
  traitName: string; // e.g. "Systematic & Disciplined"
  description: string;
  studentQuality: string;
  studentFriendlyExplanation: string | null;
}

export interface LayerReport {
  scores: EnrichedTraitScore[]; // canonical trait order
  ranking: TraitKey[]; // highest first
  flags: string[];
}

export interface ReliabilityReport {
  ari: AriResult; // dc always present; tc/ari null until timing available
  aci: AciResult;
  ori: OriResult;
  rvs: RvsResult;
}

export interface AssessmentReport {
  traitScores: Record<string, number>; // flat 18-trait map (TraitKey -> 0-100)
  riasec: LayerReport;
  bigFive: LayerReport;
  aptitude: LayerReport;
  cognitive: LayerReport;
  dominantCareerStyle: DominantCareerStyle;
  dominantPersonalityStyle: DominantPersonalityStyle;
  streamFit: StreamFitResult;
  graduationPathways: GraduationFitResult;
  careerFit: CareerFitResult | null; // null until domainUnits (library) are supplied
  reliability: ReliabilityReport;
  meta: {
    computedAt: string;
    timingAvailable: boolean;
    pending: string[]; // report sections awaiting client sign-off
  };
}

export interface ScoreInput {
  answers: AnsweredQuestion[];
  startedAt: Date;
  submittedAt: Date;
  // Distinct (cluster, industry, domain) tuples from the career library, with each
  // domain's best AI-resilience rank. Supplied by the service; when omitted, Career Fit
  // is left null (the engine stays pure and testable without the DB).
  domainUnits?: DomainUnit[];
}

function enrich(layer: Layer, scores: TraitScore[]): EnrichedTraitScore[] {
  const traitDefByKey = new Map(scoringData.traitDefinitions.map((d) => [d.key, d]));
  return scores.map((s) => {
    const def = traitDefByKey.get(s.trait);
    return {
      ...s,
      layer,
      traitName: def?.traitName ?? s.trait,
      description: def?.description ?? "",
      studentQuality: def?.studentQuality ?? "",
      studentFriendlyExplanation: def?.studentFriendlyExplanation ?? null,
    };
  });
}

export function scoreAssessment(input: ScoreInput): AssessmentReport {
  const { answers, startedAt, submittedAt, domainUnits } = input;

  const riasec = scoreRiasec(answers);
  const bigFive = scoreBigFive(answers);
  const aptitude = scoreAptitude(answers);
  const cognitive = scoreCognitive(answers);

  // Flat 18-trait map used by Stream Fit (and later Career Fit).
  const allScores = [...riasec.scores, ...bigFive.scores, ...aptitude.scores, ...cognitive.scores];
  const traitScores: Record<string, number> = {};
  for (const s of allScores) traitScores[s.trait] = s.score;
  const profile = traitScores as TraitScoreMap;

  const ari = computeAri(answers);
  const aci = computeAci(answers);
  const ori = computeOri(startedAt, submittedAt);
  const rvs = computeRvs(answers);

  const graduationPathways = scoreGraduationPathways(profile);
  const careerFit = domainUnits ? scoreCareerFit(profile, domainUnits) : null;
  // TC/ARI are only "pending" while the attempt carries no per-question timing — once
  // every aptitude answer has a timeTakenMs they are fully computed.
  const pending = ari.timingAvailable ? [] : ["timeConsistency", "ari"];
  if (!careerFit) pending.push("careerFit");

  return {
    traitScores,
    riasec: { scores: enrich("RIASEC", riasec.scores), ranking: riasec.ranking, flags: riasec.flags },
    bigFive: { scores: enrich("BIG_FIVE", bigFive.scores), ranking: bigFive.ranking, flags: bigFive.flags },
    aptitude: { scores: enrich("APTITUDE", aptitude.scores), ranking: aptitude.ranking, flags: [] },
    cognitive: { scores: enrich("COGNITIVE", cognitive.scores), ranking: cognitive.ranking, flags: [] },
    dominantCareerStyle: resolveDominantCareerStyle(riasec.ranking),
    dominantPersonalityStyle: resolveDominantPersonalityStyle(bigFive.ranking),
    streamFit: scoreStreamFit(profile),
    graduationPathways,
    careerFit,
    reliability: { ari, aci, ori, rvs },
    meta: {
      computedAt: new Date().toISOString(),
      timingAvailable: ari.timingAvailable,
      pending,
    },
  };
}
