// Dominant Personality Style (DPS): the student's top-2 ranked Big Five traits form a
// 2-letter hyphenated code (rank1-rank2) looked up against the 20 permutations.

import { BIG_FIVE_LETTER_BY_TRAIT } from "./config.js";
import { scoringData } from "./data/store.js";
import type { TraitKey } from "./types.js";

export interface DominantPersonalityStyle {
  code: string;
  style: string;
  description: string;
  explanation: string;
}

// `bigFiveRanking` is the full 5-trait ranking (most evident first) from scoreBigFive.
export function resolveDominantPersonalityStyle(
  bigFiveRanking: TraitKey[]
): DominantPersonalityStyle {
  const code = bigFiveRanking
    .slice(0, 2)
    .map((t) => BIG_FIVE_LETTER_BY_TRAIT[t] ?? "")
    .join("-");
  const byCode = new Map(scoringData.bigFive20.map((e) => [e.code, e]));
  const entry = byCode.get(code);
  if (!entry) {
    throw new Error(`No Big Five-20 entry for code "${code}"`);
  }
  return {
    code: entry.code,
    style: entry.style,
    description: entry.description,
    explanation: entry.explanation,
  };
}
