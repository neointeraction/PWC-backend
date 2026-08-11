import {
  BIG_FIVE_FLAG_ALL_LOW,
  BIG_FIVE_FLAG_BALANCED,
  BIG_FIVE_TRAITS,
  TIEBREAK_ORDER,
} from "./config.js";
import { scoreLikertLayer } from "./likert.js";
import { rankTraits } from "./ranking.js";
import type { AnsweredQuestion, TraitKey, TraitScore } from "./types.js";

export interface BigFiveResult {
  scores: TraitScore[];
  ranking: TraitKey[]; // most-evident first (drives DPS top-2)
  flags: string[];
}

export function scoreBigFive(answers: AnsweredQuestion[]): BigFiveResult {
  const scores = scoreLikertLayer("BIG_FIVE", BIG_FIVE_TRAITS, answers);
  const ranking = rankTraits(
    scores.map((s) => ({ trait: s.trait, score: s.score, tieBreak1: -s.neutralCount })),
    TIEBREAK_ORDER.BIG_FIVE
  );

  const flags: string[] = [];
  const values = scores.map((s) => s.score);
  if (values.every((v) => v < 45)) flags.push(BIG_FIVE_FLAG_ALL_LOW);

  // Balanced/low-differentiation: top two ranked scores within 5 points.
  const scoreByTrait = new Map(scores.map((s) => [s.trait, s.score]));
  const rank1 = ranking[0] != null ? scoreByTrait.get(ranking[0]) : undefined;
  const rank2 = ranking[1] != null ? scoreByTrait.get(ranking[1]) : undefined;
  if (rank1 != null && rank2 != null && rank1 - rank2 <= 5) {
    flags.push(BIG_FIVE_FLAG_BALANCED);
  }

  return { scores, ranking, flags };
}
