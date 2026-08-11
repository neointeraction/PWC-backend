// Student Career Readiness Index (SCRI) — six counsellor-rated indicators (S1..S6,
// each 1-4), rated after Session 2. Total 6-24 maps to a 4-band readiness scale
// (Counsellor Form Chart, "SCRI Band Reference").

export interface ScriInput {
  confidence: number | null;
  reasonedThinking: number | null;
  reducedAnxiety: number | null;
  selfAwareness: number | null;
  careerCuriosity: number | null;
  decisionOwnership: number | null;
}

export interface ScriResult {
  total: number | null; // 6-24, or null until all six are rated
  band: number | null; // 1-4
  label: string | null; // "PreExploration" .. "Career Ready"
}

const BANDS: { min: number; max: number; band: number; label: string }[] = [
  { min: 6, max: 10, band: 1, label: "PreExploration" },
  { min: 11, max: 15, band: 2, label: "Early Exploration" },
  { min: 16, max: 20, band: 3, label: "Active Exploration" },
  { min: 21, max: 24, band: 4, label: "Career Ready" },
];

function valid(n: number | null): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= 4;
}

export function computeScri(input: ScriInput): ScriResult {
  const values = [
    input.confidence,
    input.reasonedThinking,
    input.reducedAnxiety,
    input.selfAwareness,
    input.careerCuriosity,
    input.decisionOwnership,
  ];
  // The band is only meaningful once every indicator is rated.
  if (!values.every(valid)) {
    return { total: null, band: null, label: null };
  }
  const total = values.reduce((a, b) => a + b, 0);
  const match = BANDS.find((b) => total >= b.min && total <= b.max);
  return { total, band: match?.band ?? null, label: match?.label ?? null };
}
