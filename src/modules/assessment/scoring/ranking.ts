// Generic trait ranking with the two-step tie-break shared by every layer.

import type { TraitKey } from "./types.js";

export interface Rankable {
  trait: TraitKey;
  score: number; // already rounded to 2 dp, so equality is exact
  tieBreak1: number; // higher ranks higher (e.g. -neutralCount, or DC score)
}

// Ranks traits highest-first by: score, then tieBreak1 (Construct Step 1), then the
// fixed fallback order (Construct Step 2). Returns traits in ranked order.
export function rankTraits(items: Rankable[], fallbackOrder: TraitKey[]): TraitKey[] {
  const orderIndex = new Map(fallbackOrder.map((t, i) => [t, i]));
  return [...items]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.tieBreak1 !== a.tieBreak1) return b.tieBreak1 - a.tieBreak1;
      return (orderIndex.get(a.trait) ?? 99) - (orderIndex.get(b.trait) ?? 99);
    })
    .map((i) => i.trait);
}
