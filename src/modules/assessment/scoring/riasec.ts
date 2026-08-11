import {
  RIASEC_FLAG_ALL_LOW,
  RIASEC_FLAG_UNDIFFERENTIATED,
  RIASEC_TRAITS,
  TIEBREAK_ORDER,
} from "./config.js";
import { scoreLikertLayer } from "./likert.js";
import { rankTraits } from "./ranking.js";
import type { AnsweredQuestion, TraitKey, TraitScore } from "./types.js";

export interface RiasecResult {
  scores: TraitScore[]; // in canonical trait order
  ranking: TraitKey[]; // highest interest first (drives DCS top-3)
  flags: string[];
}

export function scoreRiasec(answers: AnsweredQuestion[]): RiasecResult {
  const scores = scoreLikertLayer("RIASEC", RIASEC_TRAITS, answers);
  const ranking = rankTraits(
    scores.map((s) => ({ trait: s.trait, score: s.score, tieBreak1: -s.neutralCount })),
    TIEBREAK_ORDER.RIASEC
  );

  const flags: string[] = [];
  const values = scores.map((s) => s.score);
  if (values.every((v) => v < 45)) flags.push(RIASEC_FLAG_ALL_LOW);
  if (Math.max(...values) - Math.min(...values) < 15) flags.push(RIASEC_FLAG_UNDIFFERENTIATED);

  return { scores, ranking, flags };
}
