// Aptitude Confidence Index (ACI) = (# "Not Sure" / total aptitude questions) × 100.
// Reported as "AAI — Aptitude Accuracy Indicator" on the report dashboard. A higher
// percentage means more avoidance, so the bands are keyed by an upper bound.

import { ACI_BANDS } from "./config.js";
import { gradeByCeiling, round2 } from "./grading.js";
import type { AnsweredQuestion } from "./types.js";

export interface AciResult {
  notSureCount: number;
  totalQuestions: number;
  dkPercent: number; // 0-100
  level: string;
  meaning: string;
}

export function computeAci(answers: AnsweredQuestion[]): AciResult {
  const aptitude = answers.filter((a) => a.section === "APTITUDE");
  const notSureCount = aptitude.filter((a) => a.response === "E").length;
  const total = aptitude.length;
  const dkPercent = total === 0 ? 0 : round2((notSureCount / total) * 100);
  const { level, meaning } = gradeByCeiling(dkPercent, ACI_BANDS);
  return { notSureCount, totalQuestions: total, dkPercent, level, meaning };
}
