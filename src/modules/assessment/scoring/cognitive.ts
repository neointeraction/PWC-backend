import { COGNITIVE_TRAITS, TIEBREAK_ORDER } from "./config.js";
import { scoreLikertLayer } from "./likert.js";
import { rankTraits } from "./ranking.js";
import type { AnsweredQuestion, TraitKey, TraitScore } from "./types.js";

export interface CognitiveResult {
  scores: TraitScore[];
  ranking: TraitKey[];
}

// Cognitive & Decision Style: 3 traits, 3 questions each. The Construct PDF defines
// no profile flags for this layer, only scoring, grading and the tie-break.
export function scoreCognitive(answers: AnsweredQuestion[]): CognitiveResult {
  const scores = scoreLikertLayer("COGNITIVE", COGNITIVE_TRAITS, answers);
  const ranking = rankTraits(
    scores.map((s) => ({ trait: s.trait, score: s.score, tieBreak1: -s.neutralCount })),
    TIEBREAK_ORDER.COGNITIVE
  );
  return { scores, ranking };
}
