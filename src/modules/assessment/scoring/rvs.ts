// Response Validity Score (RVS) — internal-consistency check across the 10 mirror
// pairs (RIASEC + Big Five + Cognitive; not Aptitude). Reported as "EIM — Engagement
// Integrity Measure".
//
// Each mirror pair is an opposite-construct pair, so a consistent responder rates the
// two items FAR apart and a contradictory one rates them SIMILARLY. gap = |rawA - rawB|
// on the raw punched 1-5 responses (never the reverse-converted value — Construct PDF
// note). Gap -> severity -> penalty; the final score SUMS the penalties from 100
// (confirmed with PWC: "average" in the source is superseded by "sum" so the Generally
// Consistent / Inconsistent grade bands are actually reachable).

import { MIRROR_PAIRS, RVS_BANDS } from "./config.js";
import { gradeByFloor } from "./grading.js";
import type { AnsweredQuestion } from "./types.js";

const MILD_PENALTY = -5;
const STRONG_PENALTY = -10;

export type PairSeverity = "good" | "acceptable" | "mild" | "strong";

export interface MirrorPairResult {
  code: string; // "MP1".."MP10"
  a: string; // question code
  b: string;
  responseA: number;
  responseB: number;
  gap: number; // 0-4
  severity: PairSeverity;
  penalty: number; // 0 | -5 | -10
}

export interface RvsResult {
  score: number; // 0-100
  level: string;
  meaning: string;
  totalPenalty: number;
  contradictionCount: number; // pairs with a mild or strong contradiction
  mildCount: number;
  strongCount: number;
  evaluatedPairs: number; // pairs both of whose responses were valid 1-5
  pairs: MirrorPairResult[];
}

function toLikert(response: number | string | null): number | null {
  const n = typeof response === "number" ? response : Number(response);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function classify(gap: number): { severity: PairSeverity; penalty: number } {
  if (gap >= 3) return { severity: "good", penalty: 0 };
  if (gap === 2) return { severity: "acceptable", penalty: 0 };
  if (gap === 1) return { severity: "mild", penalty: MILD_PENALTY };
  return { severity: "strong", penalty: STRONG_PENALTY };
}

export function computeRvs(answers: AnsweredQuestion[]): RvsResult {
  const responseByCode = new Map(answers.map((a) => [a.questionCode, toLikert(a.response)]));

  const pairs: MirrorPairResult[] = [];
  let totalPenalty = 0;
  let mildCount = 0;
  let strongCount = 0;

  for (const mp of MIRROR_PAIRS) {
    const responseA = responseByCode.get(mp.a);
    const responseB = responseByCode.get(mp.b);
    // Post-submit every question is answered, but skip defensively if a raw value is
    // missing/invalid so one bad row can't NaN the whole score.
    if (responseA == null || responseB == null) continue;

    const gap = Math.abs(responseA - responseB);
    const { severity, penalty } = classify(gap);
    if (severity === "mild") mildCount += 1;
    if (severity === "strong") strongCount += 1;
    totalPenalty += penalty;
    pairs.push({ code: mp.code, a: mp.a, b: mp.b, responseA, responseB, gap, severity, penalty });
  }

  const score = Math.max(0, Math.min(100, 100 + totalPenalty));
  const { level, meaning } = gradeByFloor(score, RVS_BANDS);

  return {
    score,
    level,
    meaning,
    totalPenalty,
    contradictionCount: mildCount + strongCount,
    mildCount,
    strongCount,
    evaluatedPairs: pairs.length,
    pairs,
  };
}
