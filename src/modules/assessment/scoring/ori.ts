// Overall Assessment Reliability Index (ORI) — grades the total completion time
// against the Construct PDF's non-monotonic benchmark (both too-fast and too-slow
// reduce reliability). Reported as "HRS — Holistic Reliability Score".

import { ORI_BANDS } from "./config.js";
import { gradeByRange, round2 } from "./grading.js";

export interface OriResult {
  completionMinutes: number;
  level: string;
  meaning: string;
}

export function computeOri(startedAt: Date, submittedAt: Date): OriResult {
  const minutes = round2((submittedAt.getTime() - startedAt.getTime()) / 60000);
  const { level, meaning } = gradeByRange(minutes, ORI_BANDS);
  return { completionMinutes: minutes, level, meaning };
}
