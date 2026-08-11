// Grade-band lookup helpers shared across the scoring engine.

import type { CeilingBand, TimeBand } from "./config.js";
import type { GradeBand } from "./types.js";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Bands ordered high-min first; returns the first whose inclusive lower bound the
// score meets. Bands must cover down to 0.
export function gradeByFloor(score: number, bands: GradeBand[]): { level: string; meaning: string } {
  for (const band of bands) {
    if (score >= band.min) {
      return { level: band.level, meaning: band.meaning };
    }
  }
  // Bands always include a { min: 0 } catch-all, so a miss means misconfiguration.
  throw new Error("gradeByFloor: no band matched (bands must cover down to 0)");
}

// Bands ordered low-max first; returns the first whose inclusive upper bound covers
// the value (used by ACI, where a higher percentage is worse).
export function gradeByCeiling(value: number, bands: CeilingBand[]): { level: string; meaning: string } {
  for (const band of bands) {
    if (value <= band.max) {
      return { level: band.level, meaning: band.meaning };
    }
  }
  throw new Error("gradeByCeiling: no band matched (bands must cover up to 100)");
}

// Matches a value to the first [minMinutes, maxMinutes] range that contains it.
export function gradeByRange(minutes: number, bands: TimeBand[]): { level: string; meaning: string } {
  for (const band of bands) {
    if (minutes >= band.minMinutes && minutes <= band.maxMinutes) {
      return { level: band.level, meaning: band.meaning };
    }
  }
  throw new Error("gradeByRange: no band matched (bands must cover all minutes)");
}
