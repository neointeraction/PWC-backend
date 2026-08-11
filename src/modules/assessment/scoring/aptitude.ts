// Aptitude scoring: weighted correctness per area (Easy ×1, Medium ×1.5, Hard ×2).
// "Not Sure" (option E) and any wrong answer score 0. Trait % = earned / max × 100.
// Tie-break Step 1 uses the trait's Difficulty Consistency score (from ARI), Step 2
// the fixed order Logical > Numerical > Verbal > Spatial (Construct PDF).

import { APTITUDE_TRAITS, TIEBREAK_ORDER, TRAIT_GRADE_BANDS } from "./config.js";
import { computeDifficultyConsistency } from "./ari.js";
import { gradeByFloor, round2 } from "./grading.js";
import { rankTraits } from "./ranking.js";
import type { AnsweredQuestion, TraitKey, TraitScore } from "./types.js";

export interface AptitudeResult {
  scores: TraitScore[];
  ranking: TraitKey[];
}

function scoreAptitudeTrait(trait: TraitKey, questions: AnsweredQuestion[]): TraitScore {
  if (questions.length === 0) {
    throw new Error(`No aptitude questions for trait ${trait}`);
  }
  let earned = 0;
  let max = 0;
  for (const q of questions) {
    max += q.weight;
    if (q.correctOption != null && q.response === q.correctOption) {
      earned += q.weight;
    }
  }
  const score = round2((earned / max) * 100);
  const { level, meaning } = gradeByFloor(score, TRAIT_GRADE_BANDS.APTITUDE);
  // neutralCount is not meaningful for aptitude; kept 0 for a uniform TraitScore shape.
  return { trait, score, level, levelMeaning: meaning, neutralCount: 0 };
}

export function scoreAptitude(answers: AnsweredQuestion[]): AptitudeResult {
  const byTrait = new Map<TraitKey, AnsweredQuestion[]>();
  for (const a of answers) {
    if (a.section !== "APTITUDE") continue;
    const list = byTrait.get(a.trait) ?? [];
    list.push(a);
    byTrait.set(a.trait, list);
  }
  const scores = APTITUDE_TRAITS.map((t) => scoreAptitudeTrait(t, byTrait.get(t) ?? []));

  const { perTrait: dcByTrait } = computeDifficultyConsistency(answers);
  const ranking = rankTraits(
    scores.map((s) => ({ trait: s.trait, score: s.score, tieBreak1: dcByTrait[s.trait] ?? 0 })),
    TIEBREAK_ORDER.APTITUDE
  );

  return { scores, ranking };
}
