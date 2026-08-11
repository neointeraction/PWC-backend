// Stream Fit (Class 11 & 12): every sub-stream defines a weighted top-5 of the 18
// traits (weights sum to 100). Fit Score = Σ(traitScore × weight/100). The report
// shows the top 3 sub-streams overall by Fit Score. (Construct PDF "Stream
// Recommendation Engine".)

import { FIT_BANDS, FIT_QUALIFYING_MIN } from "./config.js";
import { streamWeights } from "./data/stream-weights.js";
import { gradeByFloor, round2 } from "./grading.js";
import type { TraitKey } from "./types.js";

export interface StreamFit {
  mainStream: string;
  subStream: string;
  coreSubjects: string | null;
  electiveSubjects: string | null;
  explanation: string | null;
  fitScore: number; // 0-100
  level: string;
  meaning: string;
  weights: Partial<Record<TraitKey, number>>;
}

export type TraitScoreMap = Record<TraitKey, number>;

function fitScore(weights: Partial<Record<TraitKey, number>>, profile: TraitScoreMap): number {
  let total = 0;
  for (const [trait, weight] of Object.entries(weights)) {
    if (weight == null) continue;
    total += (profile[trait as TraitKey] ?? 0) * (weight / 100);
  }
  return round2(total);
}

export interface StreamFitResult {
  ranked: StreamFit[]; // all sub-streams, highest fit first
  top3: StreamFit[]; // best qualifying (>= FIT_QUALIFYING_MIN) sub-streams, up to 3
}

export function scoreStreamFit(profile: TraitScoreMap): StreamFitResult {
  const ranked = streamWeights
    .map((s): StreamFit => {
      const score = fitScore(s.weights, profile);
      const { level, meaning } = gradeByFloor(score, FIT_BANDS);
      return {
        mainStream: s.mainStream,
        subStream: s.subStream,
        coreSubjects: s.coreSubjects,
        electiveSubjects: s.electiveSubjects,
        explanation: s.explanation,
        fitScore: score,
        level,
        meaning,
        weights: s.weights,
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore);

  // Only recommend sub-streams meeting the required Fit Score — fewer than 3 if that's
  // all that qualifies (Construct PDF: weak-fit options "would not have been considered").
  const top3 = ranked.filter((s) => s.fitScore >= FIT_QUALIFYING_MIN).slice(0, 3);
  return { ranked, top3 };
}
