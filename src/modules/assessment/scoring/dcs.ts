// Dominant Career Style (DCS): the student's top-3 ranked RIASEC traits form a
// 3-letter code (rank1-rank2-rank3) looked up against the 120 permutations.

import { RIASEC_LETTER_BY_TRAIT } from "./config.js";
import { scoringData } from "./data/store.js";
import type { TraitKey } from "./types.js";

export interface DominantCareerStyle {
  code: string;
  traits: TraitKey[];
  style: string;
  description: string;
  explanation: string;
}

// `riasecRanking` is the full 6-trait ranking (highest interest first) from scoreRiasec.
export function resolveDominantCareerStyle(riasecRanking: TraitKey[]): DominantCareerStyle {
  const code = riasecRanking
    .slice(0, 3)
    .map((t) => RIASEC_LETTER_BY_TRAIT[t] ?? "")
    .join("");
  const byCode = new Map(scoringData.riasec120.map((e) => [e.code, e]));
  const entry = byCode.get(code);
  if (!entry) {
    throw new Error(`No RIASEC-120 entry for code "${code}"`);
  }
  return {
    code: entry.code,
    traits: entry.traits,
    style: entry.style,
    description: entry.description,
    explanation: entry.explanation,
  };
}
