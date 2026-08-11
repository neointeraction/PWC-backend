// Shared types for the assessment scoring engine. The engine is a set of pure
// functions over a normalized view of a submitted attempt — it never touches Prisma
// directly, so every piece is unit-testable with plain objects.

export type TraitKey =
  | "REALISTIC"
  | "INVESTIGATIVE"
  | "ARTISTIC"
  | "SOCIAL"
  | "ENTERPRISING"
  | "CONVENTIONAL"
  | "OPENNESS"
  | "CONSCIENTIOUSNESS"
  | "EXTRAVERSION"
  | "AGREEABLENESS"
  | "EMOTIONAL_STABILITY"
  | "NUMERICAL"
  | "VERBAL"
  | "LOGICAL"
  | "SPATIAL"
  | "LEARNING_VELOCITY"
  | "UNCERTAINTY_TOLERANCE"
  | "AUTONOMY_PREFERENCE";

export type Layer = "RIASEC" | "BIG_FIVE" | "APTITUDE" | "COGNITIVE";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

// One answered question, normalized from AssessmentAnswer + its AssessmentQuestion.
// `response` is the raw student input: a 1-5 integer for Likert items, or an option
// value ("A".."E", where "E" == "Not sure") for aptitude MCQs.
export interface AnsweredQuestion {
  questionCode: string; // "Q1".."Q73"
  section: Layer;
  trait: TraitKey;
  traitCode: string | null; // "R1", "NR1", ...
  difficulty: Difficulty | null; // aptitude only
  weight: number;
  correctOption: string | null; // aptitude only
  format: "LIKERT_5" | "MCQ_SINGLE";
  order: number;
  response: number | string | null; // 1-5 | "A".."E" | null (unanswered)
  timeTakenMs?: number | null; // per-question elapsed time (aptitude TC); optional
}

// A trait's computed score, its grade band, and the raw response signals used for
// ranking/tie-breaks so callers don't have to recompute them.
export interface TraitScore {
  trait: TraitKey;
  score: number; // 0-100, rounded to 2 dp
  level: string; // grade label for the trait's layer
  levelMeaning: string;
  neutralCount: number; // Likert layers: number of "3" responses among the trait's items
}

export interface GradeBand {
  min: number; // inclusive lower bound; bands checked high-to-low
  level: string;
  meaning: string;
}

export interface GradedValue {
  score: number;
  level: string;
  meaning: string;
}
