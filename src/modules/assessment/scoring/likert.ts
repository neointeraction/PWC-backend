// Shared 5-point-scale scoring for the three Likert layers (RIASEC, Big Five,
// Cognitive & Decision). Reverse-keyed items are converted with 6 - response for the
// trait percentage (Construct PDF, Big Five "Kindly Note" 1); a punched Neutral (3)
// is counted for the tie-break regardless of keying, since 6 - 3 = 3.

import { REVERSE_KEYED_CODES, TRAIT_GRADE_BANDS } from "./config.js";
import { gradeByFloor, round2 } from "./grading.js";
import type { AnsweredQuestion, Layer, TraitKey, TraitScore } from "./types.js";

const LIKERT_MAX_PER_QUESTION = 5;

function asLikert(response: number | string | null, code: string): number {
  const n = typeof response === "number" ? response : Number(response);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error(`Invalid Likert response ${JSON.stringify(response)} for ${code}`);
  }
  return n;
}

// Computes the 0-100 score and grade for a single trait from its answered questions.
export function scoreLikertTrait(
  layer: Layer,
  trait: TraitKey,
  questions: AnsweredQuestion[]
): TraitScore {
  if (questions.length === 0) {
    throw new Error(`No questions found for trait ${trait}`);
  }
  let sum = 0;
  let neutralCount = 0;
  for (const q of questions) {
    const raw = asLikert(q.response, q.questionCode);
    if (raw === 3) neutralCount += 1;
    sum += REVERSE_KEYED_CODES.has(q.questionCode) ? 6 - raw : raw;
  }
  const score = round2((sum / (questions.length * LIKERT_MAX_PER_QUESTION)) * 100);
  const { level, meaning } = gradeByFloor(score, TRAIT_GRADE_BANDS[layer]);
  return { trait, score, level, levelMeaning: meaning, neutralCount };
}

// Scores every trait in a Likert layer. `traits` fixes the trait set/order; questions
// are grouped by their trait key.
export function scoreLikertLayer(
  layer: Layer,
  traits: TraitKey[],
  answers: AnsweredQuestion[]
): TraitScore[] {
  const byTrait = new Map<TraitKey, AnsweredQuestion[]>();
  for (const a of answers) {
    if (a.section !== layer) continue;
    const list = byTrait.get(a.trait) ?? [];
    list.push(a);
    byTrait.set(a.trait, list);
  }
  return traits.map((trait) => scoreLikertTrait(layer, trait, byTrait.get(trait) ?? []));
}
