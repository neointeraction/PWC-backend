// Aptitude Reliability Index (ARI) = DC×0.6 + TC×0.4 (Construct PDF).
//
// Difficulty Consistency (DC) is always computable from the answer pattern. Time
// Consistency (TC) needs per-question elapsed time, which the frontend does not yet
// send (open item A) — so TC and the composite ARI are computed only when every
// aptitude question carries `timeTakenMs`; otherwise they are null and callers should
// surface DC alone until timing is wired.

import { APTITUDE_TRAITS, ARI_BANDS } from "./config.js";
import { gradeByFloor, round2 } from "./grading.js";
import type { AnsweredQuestion, GradedValue, TraitKey } from "./types.js";

const TIME_THRESHOLD_MS = 5000; // "within 5 seconds"

function isCorrect(q: AnsweredQuestion): boolean {
  return q.correctOption != null && q.response === q.correctOption;
}

function aptitudeByTrait(answers: AnsweredQuestion[]): Map<TraitKey, AnsweredQuestion[]> {
  const byTrait = new Map<TraitKey, AnsweredQuestion[]>();
  for (const a of answers) {
    if (a.section !== "APTITUDE") continue;
    const list = byTrait.get(a.trait) ?? [];
    list.push(a);
    byTrait.set(a.trait, list);
  }
  return byTrait;
}

// --- Difficulty Consistency ---

// Maps one trait's 5-question correctness pattern to the Construct's penalty table.
// Possibilities are evaluated in order 1-6; the first match applies (patterns can
// overlap but the numbered order is authoritative). No match => 0 penalty => DC 100.
export function difficultyConsistencyPenalty(traitQuestions: AnsweredQuestion[]): number {
  const easy = traitQuestions.filter((q) => q.difficulty === "EASY");
  const medium = traitQuestions.filter((q) => q.difficulty === "MEDIUM");
  const hard = traitQuestions.filter((q) => q.difficulty === "HARD");

  const easyCorrect = easy.filter(isCorrect).length;
  const mediumCorrect = medium.filter(isCorrect).length;
  const hardCorrect = hard.some(isCorrect);

  const allEasyWrong = easyCorrect === 0;
  const anyEasyCorrect = easyCorrect > 0;
  const allEasyCorrect = easyCorrect === easy.length && easy.length > 0;
  const allMediumWrong = mediumCorrect === 0;
  const anyMediumCorrect = mediumCorrect > 0;
  const allMediumCorrect = mediumCorrect === medium.length && medium.length > 0;
  const cleanSweep = allEasyCorrect && allMediumCorrect && hardCorrect;

  // 1: Hard correct + all other wrong
  if (hardCorrect && allEasyWrong && allMediumWrong) return -75;
  // 2: all Easy wrong + any Medium correct + Hard correct
  if (allEasyWrong && anyMediumCorrect && hardCorrect) return -60;
  // 3: any Easy correct + all Medium wrong + Hard correct
  if (anyEasyCorrect && allMediumWrong && hardCorrect) return -45;
  // 4: any Easy correct + any Medium correct + Hard correct — but NOT a clean sweep.
  // A fully-correct pattern isn't one of the 6 "statistically unusual" signatures in
  // the Construct's ✅/❌ table, so it falls through to 0. (Exact boundary of P3/P4 is
  // an open confirmation item with PWC.)
  if (!cleanSweep && anyEasyCorrect && anyMediumCorrect && hardCorrect) return -30;
  // 5: all Easy wrong + any Medium correct + Hard wrong
  if (allEasyWrong && anyMediumCorrect && !hardCorrect) return -45;
  // 6: all Easy wrong + all Medium correct + Hard wrong
  if (allEasyWrong && allMediumCorrect && !hardCorrect) return -45;
  return 0;
}

export interface DifficultyConsistency {
  perTrait: Record<string, number>; // trait -> DC (0-100)
  dc: number; // mean of the 4 traits
}

export function computeDifficultyConsistency(answers: AnsweredQuestion[]): DifficultyConsistency {
  const byTrait = aptitudeByTrait(answers);
  const perTrait: Record<string, number> = {};
  const values: number[] = [];
  for (const trait of APTITUDE_TRAITS) {
    const qs = byTrait.get(trait) ?? [];
    const dc = 100 + difficultyConsistencyPenalty(qs);
    perTrait[trait] = dc;
    values.push(dc);
  }
  return { perTrait, dc: round2(values.reduce((a, b) => a + b, 0) / values.length) };
}

// --- Time Consistency (needs per-question timing) ---

function timeConsistencyPenalty(q: AnsweredQuestion): number {
  const t = q.timeTakenMs;
  if (t == null || t >= TIME_THRESHOLD_MS) return 0;
  const notSure = q.response === "E";
  if (q.difficulty === "HARD") {
    // Hard answered <5s, correct or wrong, but not 'Not Sure'
    return notSure ? 0 : -70;
  }
  // Easy & Medium answered <5s and wrong
  return !notSure && !isCorrect(q) ? -40 : 0;
}

// Returns null unless every aptitude question has a timeTakenMs value.
export function computeTimeConsistency(answers: AnsweredQuestion[]): number | null {
  const byTrait = aptitudeByTrait(answers);
  const aptitude = [...byTrait.values()].flat();
  if (aptitude.length === 0 || aptitude.some((q) => q.timeTakenMs == null)) return null;

  const perTraitAverages: number[] = [];
  for (const trait of APTITUDE_TRAITS) {
    const qs = byTrait.get(trait) ?? [];
    if (qs.length === 0) continue;
    const perQuestion = qs.map((q) => 100 + timeConsistencyPenalty(q));
    perTraitAverages.push(perQuestion.reduce((a, b) => a + b, 0) / qs.length);
  }
  return round2(perTraitAverages.reduce((a, b) => a + b, 0) / perTraitAverages.length);
}

export interface AriResult {
  dc: number;
  tc: number | null; // null until per-question timing is available
  ari: GradedValue | null; // null when tc is null
  timingAvailable: boolean;
}

export function computeAri(answers: AnsweredQuestion[]): AriResult {
  const { dc } = computeDifficultyConsistency(answers);
  const tc = computeTimeConsistency(answers);
  if (tc == null) {
    return { dc, tc: null, ari: null, timingAvailable: false };
  }
  const ariScore = round2(dc * 0.6 + tc * 0.4);
  const { level, meaning } = gradeByFloor(ariScore, ARI_BANDS);
  return { dc, tc, ari: { score: ariScore, level, meaning }, timingAvailable: true };
}
