// Shared weighted Fit-Score helper (Construct PDF: Fit = Σ traitScore × weight).
// Weights are percentages; `weightSum` normalizes the result to 0-100 so rows whose
// weights don't total 100 (a few career-domain rows sum to 85-95) aren't under-scored.

import { round2 } from "./grading.js";
import type { TraitKey } from "./types.js";

export type TraitScoreMap = Record<TraitKey, number>;

export function weightedFit(
  weights: Partial<Record<TraitKey, number>>,
  profile: TraitScoreMap,
  weightSum = 100
): number {
  let total = 0;
  for (const [trait, weight] of Object.entries(weights)) {
    if (weight == null) continue;
    total += (profile[trait as TraitKey] ?? 0) * weight;
  }
  // total is Σ(score × weightPct); divide by the actual weight total to normalize.
  const denom = weightSum > 0 ? weightSum : 100;
  return round2(total / denom);
}
