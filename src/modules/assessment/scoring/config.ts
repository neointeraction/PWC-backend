// Scoring keys and constants derived from the Class 9 & 10 Assessment Tool Construct
// and Questionnaire PDFs. This is scoring *logic* configuration (reverse keys, mirror
// pairs, tie-break orders, grade bands) — distinct from the bulk lookup tables under
// ./data (RIASEC-120 styles, weight tables) which are extracted from the workbook.

import type { GradeBand, Layer, TraitKey } from "./types.js";

// --- Trait -> layer map and canonical per-layer trait order ---

export const RIASEC_TRAITS: TraitKey[] = [
  "REALISTIC",
  "INVESTIGATIVE",
  "ARTISTIC",
  "SOCIAL",
  "ENTERPRISING",
  "CONVENTIONAL",
];

export const BIG_FIVE_TRAITS: TraitKey[] = [
  "OPENNESS",
  "CONSCIENTIOUSNESS",
  "EXTRAVERSION",
  "AGREEABLENESS",
  "EMOTIONAL_STABILITY",
];

export const APTITUDE_TRAITS: TraitKey[] = ["NUMERICAL", "VERBAL", "LOGICAL", "SPATIAL"];

export const COGNITIVE_TRAITS: TraitKey[] = [
  "LEARNING_VELOCITY",
  "UNCERTAINTY_TOLERANCE",
  "AUTONOMY_PREFERENCE",
];

export const TRAITS_BY_LAYER: Record<Layer, TraitKey[]> = {
  RIASEC: RIASEC_TRAITS,
  BIG_FIVE: BIG_FIVE_TRAITS,
  APTITUDE: APTITUDE_TRAITS,
  COGNITIVE: COGNITIVE_TRAITS,
};

// Single-letter codes used to build DCS (3-letter RIASEC) and DPS (2-letter Big Five)
// lookup keys. Note Big Five "S" is Emotional Stability (workbook "Big Five 20" sheet).
export const RIASEC_LETTER_BY_TRAIT: Partial<Record<TraitKey, string>> = {
  REALISTIC: "R",
  INVESTIGATIVE: "I",
  ARTISTIC: "A",
  SOCIAL: "S",
  ENTERPRISING: "E",
  CONVENTIONAL: "C",
};

export const BIG_FIVE_LETTER_BY_TRAIT: Partial<Record<TraitKey, string>> = {
  OPENNESS: "O",
  CONSCIENTIOUSNESS: "C",
  EXTRAVERSION: "E",
  AGREEABLENESS: "A",
  EMOTIONAL_STABILITY: "S",
};

// --- Reverse-keyed questions (Big Five + Cognitive) ---
// Reverse Keyed Summary, questionnaire PDF p.11. For trait % scoring these use the
// reverse-converted score (6 - response); for RVS they use the raw punched response.
export const REVERSE_KEYED_CODES: ReadonlySet<string> = new Set([
  "Q28", // Openness O4
  "Q32", // Conscientiousness C4
  "Q36", // Extraversion E4
  "Q40", // Agreeableness AG4
  "Q43", // Emotional Stability ES3
  "Q67", // Learning Velocity LV3
  "Q70", // Uncertainty Tolerance UT3
  "Q73", // Autonomy Preference AP3
]);

// --- RVS mirror pairs (Mirror Pairs Summary, questionnaire PDF p.11) ---
// Note Q73 appears in both MP9 and MP10 — a single question can belong to multiple
// pairs, which is why pairs live here rather than as a column on the question.
export interface MirrorPair {
  code: string; // "MP1".."MP10"
  a: string; // question code
  b: string; // question code
}

export const MIRROR_PAIRS: readonly MirrorPair[] = [
  { code: "MP1", a: "Q4", b: "Q16" },
  { code: "MP2", a: "Q8", b: "Q20" },
  { code: "MP3", a: "Q12", b: "Q24" },
  { code: "MP4", a: "Q27", b: "Q44" },
  { code: "MP5", a: "Q33", b: "Q36" },
  { code: "MP6", a: "Q38", b: "Q40" },
  { code: "MP7", a: "Q65", b: "Q67" },
  { code: "MP8", a: "Q68", b: "Q70" },
  { code: "MP9", a: "Q71", b: "Q73" },
  { code: "MP10", a: "Q72", b: "Q73" },
];

// --- Tie-break fallback priority orders (Construct PDF, per layer Step 2) ---
// Earlier entries rank higher. Step 1 (fewer neutral responses / higher DC for
// aptitude) is applied before falling back to these fixed orders.
export const TIEBREAK_ORDER: Record<Layer, TraitKey[]> = {
  RIASEC: ["INVESTIGATIVE", "ENTERPRISING", "SOCIAL", "ARTISTIC", "CONVENTIONAL", "REALISTIC"],
  BIG_FIVE: ["OPENNESS", "CONSCIENTIOUSNESS", "EXTRAVERSION", "AGREEABLENESS", "EMOTIONAL_STABILITY"],
  APTITUDE: ["LOGICAL", "NUMERICAL", "VERBAL", "SPATIAL"],
  COGNITIVE: ["LEARNING_VELOCITY", "UNCERTAINTY_TOLERANCE", "AUTONOMY_PREFERENCE"],
};

// --- Per-layer trait grade bands (Construct PDF "Now classify each trait as") ---
// Bands are checked high min first; `min` is the inclusive lower bound.
export const TRAIT_GRADE_BANDS: Record<Layer, GradeBand[]> = {
  RIASEC: [
    { min: 75, level: "Highly Preferred", meaning: "A strong trait with natural interest, you can expertise" },
    { min: 60, level: "Fairly Good", meaning: "Meaningful interest, above the crowd, can be developed further" },
    { min: 45, level: "Not Decisive", meaning: "Not a prominent interest but it's there" },
    { min: 0, level: "Best Avoided", meaning: "Activities associated with this trait may be less naturally appealing" },
  ],
  BIG_FIVE: [
    { min: 75, level: "Highly Evident", meaning: "This personality tendency is strongly visible in your behaviour across situations." },
    { min: 60, level: "Evident", meaning: "This tendency is generally present and influences your behaviour in many situations." },
    { min: 45, level: "Moderately Evident", meaning: "This tendency appears occasionally but is not a defining characteristic." },
    { min: 0, level: "Less Evident", meaning: "This tendency is not naturally prominent in your behavioural style." },
  ],
  APTITUDE: [
    { min: 75, level: "Advanced Capability", meaning: "Demonstrates strong natural potential in this area and can perform complex tasks with relative ease." },
    { min: 60, level: "Good Capability", meaning: "Shows above average potential and can perform effectively with practice and experience." },
    { min: 45, level: "Developing Capability", meaning: "Demonstrates moderate potential but may require additional training and exposure." },
    { min: 0, level: "Needs Development", meaning: "This area may require significant effort, practice and support to achieve strong performance." },
  ],
  COGNITIVE: [
    { min: 75, level: "Strongly Demonstrated", meaning: "This behaviour is consistently visible and is likely to support workplace effectiveness." },
    { min: 60, level: "Demonstrated", meaning: "This behaviour is generally present but may vary across situations." },
    { min: 45, level: "Emerging", meaning: "This behaviour appears occasionally but is not yet consistently demonstrated." },
    { min: 0, level: "Needs Development", meaning: "This behaviour is currently less evident and may require conscious development." },
  ],
};

// --- Profile flags (Construct PDF "To Note" comments) ---
export const RIASEC_FLAG_ALL_LOW =
  "No Strong RIASEC Preference Emerging – recommend qualitative follow-up";
export const RIASEC_FLAG_UNDIFFERENTIATED = "Highly Undifferentiated Profile";
export const BIG_FIVE_FLAG_ALL_LOW = "Stress Vulnerability – Flag for Counsellor Attention";
export const BIG_FIVE_FLAG_BALANCED = "Balanced Personality Profile, Low Differentiation";

// --- Reliability index grade bands ---

// ARI (Aptitude Reliability Index) — Construct PDF.
export const ARI_BANDS: GradeBand[] = [
  { min: 75, level: "High Reliability", meaning: "Results are trustworthy and can be used confidently for career recommendations." },
  { min: 60, level: "Moderate Reliability", meaning: "Results are generally reliable but should be interpreted alongside other assessment findings." },
  { min: 0, level: "Low Reliability", meaning: "Results may be affected by guessing, disengagement or inconsistent responding and should be reviewed carefully." },
];

// RVS (Response Validity Score) — Construct PDF.
export const RVS_BANDS: GradeBand[] = [
  { min: 80, level: "Highly Consistent Profile", meaning: "Responses demonstrated strong internal consistency and a clear understanding of personal tendencies." },
  { min: 60, level: "Generally Consistent Profile", meaning: "Responses were mostly consistent, though a few contradictions suggest some uncertainty or situational variation." },
  { min: 0, level: "Inconsistent Profile", meaning: "Responses contained multiple contradictions, requiring cautious interpretation of some assessment findings." },
];

// Fit Score bands, shared by Stream Fit and Career Fit — Construct PDF.
export const FIT_BANDS: GradeBand[] = [
  { min: 75, level: "Strong Fit", meaning: "Strong point" },
  { min: 60, level: "Good Fit", meaning: "With skill training, will do well" },
  { min: 0, level: "Weak Fit", meaning: "Consider with due diligence" },
];

// Minimum Fit Score for a stream / career / graduation option to be *recommended*.
// The output report notes that options without the required Fit Score Rating "would
// not have been considered" — so Weak-Fit (< 60) options are dropped from the surfaced
// top-N lists (though they remain in the full `ranked` arrays for the counsellor).
// 60 = the "Good Fit" floor in FIT_BANDS.
export const FIT_QUALIFYING_MIN = 60;

// --- ACI: Aptitude Confidence Index (% of "Not Sure" answers). Higher DK% = lower
// confidence, so bands are checked low-max first. Construct PDF. ---
export interface CeilingBand {
  max: number; // inclusive upper bound
  level: string;
  meaning: string;
}
export const ACI_BANDS: CeilingBand[] = [
  { max: 15, level: "High Confidence", meaning: "Demonstrates strong willingness to engage with unfamiliar or challenging problems." },
  { max: 30, level: "Balanced Confidence", meaning: "Shows a healthy balance between attempting questions and recognizing uncertainty." },
  { max: 45, level: "Developing Confidence", meaning: "Tends to hesitate when unsure and may benefit from confidence-building experiences." },
  { max: 100, level: "Limited Confidence", meaning: "Frequently avoids uncertain situations, indicating a need for greater confidence and problem-solving exposure." },
];

// --- ORI: Overall Assessment Reliability Index (completion-time bands, minutes).
// Non-monotonic — both too-fast and too-slow degrade reliability — so this is a set
// of explicit [min,max] ranges rather than thresholds. Construct PDF. ---
export interface TimeBand {
  minMinutes: number; // inclusive
  maxMinutes: number; // inclusive
  level: string;
  meaning: string;
}
export const ORI_BANDS: TimeBand[] = [
  { minMinutes: 27, maxMinutes: 36, level: "High Reliability", meaning: "Ideal completion behaviour" },
  { minMinutes: 22, maxMinutes: 26, level: "Moderate Reliability", meaning: "Slightly fast" },
  { minMinutes: 37, maxMinutes: 45, level: "Moderate Reliability", meaning: "Slightly slow" },
  { minMinutes: 16, maxMinutes: 21, level: "Low Reliability", meaning: "Likely rushed" },
  { minMinutes: 46, maxMinutes: 60, level: "Low Reliability", meaning: "Excessively slow" },
  { minMinutes: 0, maxMinutes: 15, level: "Very Low Reliability", meaning: "Highly unreliable" },
  { minMinutes: 61, maxMinutes: Number.POSITIVE_INFINITY, level: "Very Low Reliability", meaning: "Strong validity concern" },
];
