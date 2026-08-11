// Maps each Counsellor-Chart parameter row to the pre-counselling questionnaire
// field(s) that populate its Student and Parent columns. Mapped by *meaning* (the
// seeded fieldKeys are semantic) rather than by the PDF's question numbers, which are
// questionnaire-order-dependent. Some rows are single-sided (student- or parent-only).
//
// NOTE: this is a best-effort semantic alignment against the seeded pre-counselling
// forms; the exact PDF question-number cross-reference should be confirmed by the team.

export interface ChartParameter {
  code: string; // "A1.1", "B2.4", ...
  group: string; // sub-header, e.g. "A1 · Subject Preferences & Academic Performance"
  label: string;
  student: string | null; // pre-counselling STUDENT fieldKey
  parent: string | null; // pre-counselling PARENT fieldKey
}

export interface ChartSection {
  key: "academics" | "strengths" | "compass" | "goals";
  title: string;
  parameters: ChartParameter[];
}

export const CHART_SECTIONS: ChartSection[] = [
  {
    key: "academics",
    title: "Academics & Non-Academics View",
    parameters: [
      { code: "A1.1", group: "A1 · Subject Preferences & Academic Performance", label: "Favourite Subject", student: "fav_subject_block", parent: "strong_subjects_block" },
      { code: "A1.2", group: "A1 · Subject Preferences & Academic Performance", label: "Least Liked Subject", student: "hard_subject_block", parent: "struggle_subjects_block" },
      { code: "A2.1", group: "A2 · Non-Academic Activities, Hobbies & Learning Mode", label: "Non-academic / free-time activity", student: "free_time_activities", parent: "p_free_time_activities" },
      { code: "A2.2", group: "A2 · Non-Academic Activities, Hobbies & Learning Mode", label: "First Hobby — name & weekly hours", student: "hobbies_table", parent: null },
      { code: "A2.3", group: "A2 · Non-Academic Activities, Hobbies & Learning Mode", label: "Second Hobby — name & weekly hours", student: "hobbies_table", parent: null },
      { code: "A2.4", group: "A2 · Non-Academic Activities, Hobbies & Learning Mode", label: "Most enjoyed school activity", student: "school_activities", parent: null },
      { code: "A2.5", group: "A2 · Non-Academic Activities, Hobbies & Learning Mode", label: "Preferred mode of learning at school", student: "learning_style", parent: null },
    ],
  },
  {
    key: "strengths",
    title: "Strengths & Personality View",
    parameters: [
      { code: "B1.1", group: "B1 · Personal Strengths & Enjoyment", label: "Top strengths — Definitely me / Clearly see this", student: "strengths_table", parent: "p_strengths_table" },
      { code: "B1.2", group: "B1 · Personal Strengths & Enjoyment", label: "Top strengths — Somewhat me / Sometimes", student: "strengths_table", parent: "p_strengths_table" },
      { code: "B1.3", group: "B1 · Personal Strengths & Enjoyment", label: "Special skill or talent noticed by parent", student: null, parent: "unique_talent" },
      { code: "B1.4", group: "B1 · Personal Strengths & Enjoyment", label: "Consistency of interests over time", student: "interest_consistency", parent: "p_interest_consistency" },
      { code: "B2.1", group: "B2 · Personality Type & Decision-Making", label: "Perceived personality type", student: "energy_type", parent: null },
      { code: "B2.2", group: "B2 · Personality Type & Decision-Making", label: "Primary character description by parent", student: null, parent: "child_personality" },
      { code: "B2.3", group: "B2 · Personality Type & Decision-Making", label: "How student interacts with peers & teachers", student: null, parent: "child_interaction_style" },
      { code: "B2.4", group: "B2 · Personality Type & Decision-Making", label: "General approach to making important decisions", student: "decision_style", parent: "child_decision_style" },
      { code: "B3.1", group: "B3 · Obstacles & Response to Failure", label: "Main obstacles during study", student: "study_challenges", parent: "child_study_obstacle" },
      { code: "B3.2", group: "B3 · Obstacles & Response to Failure", label: "Response to failure or negative feedback", student: "failure_response", parent: "child_failure_response" },
    ],
  },
  {
    key: "compass",
    title: "Setting the Compass — Career Direction",
    parameters: [
      { code: "C1.1", group: "C1 · Career Preferences & Motivations", label: "Specific career goal or field", student: "career_in_mind", parent: "preferred_career" },
      { code: "C1.2", group: "C1 · Career Preferences & Motivations", label: "Core reason for career interest", student: "career_interest_reason", parent: "career_pref_reason" },
      { code: "C2.1", group: "C2 · Influencers & Alternative Careers", label: "Biggest influencer on career choice", student: "career_influence", parent: null },
      { code: "C2.2", group: "C2 · Influencers & Alternative Careers", label: "How well parent understands the student's interests", student: "parent_understanding", parent: null },
      { code: "C3.1", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Open to exploring alternative / unconventional careers", student: null, parent: "open_to_unconventional" },
      { code: "C3.2", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Financial constraints for future education", student: null, parent: "financial_constraints" },
      { code: "C3.3", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Openness to studying outside the city", student: null, parent: "study_away_table" },
      { code: "C3.4", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Openness to studying abroad", student: null, parent: "study_away_table" },
      { code: "C3.5", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Who makes the final education decisions", student: null, parent: "final_decision_maker" },
      { code: "C3.6", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Is the child actively involved in decisions", student: null, parent: "child_involvement" },
      { code: "C3.7", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Parent's biggest concern about the future", student: null, parent: "biggest_concern" },
      { code: "C3.8", group: "C3 · Parental Stance, Constraints & Decision Dynamics", label: "Specific issue the parent wants prioritised", student: null, parent: "specific_concern_counsellor" },
    ],
  },
  {
    key: "goals",
    title: "Counselling Goals & Programme Expectations",
    parameters: [
      { code: "D1.1", group: "D1 · Stated Counselling Objectives", label: "Primary counselling objective", student: "programme_expectations", parent: "programme_hopes" },
      { code: "D1.2", group: "D1 · Stated Counselling Objectives", label: "Anything specific for the counsellor to know", student: "notes_for_counsellor", parent: "family_context" },
    ],
  },
];

// The Class 7/8/9 marks grid comes from the student's academic-record table question.
export const ACADEMIC_RECORD_FIELDKEY = "academic_record_table";

// All valid synthesis-note codes (A1..H4), used to validate PUT payloads.
export const SYNTHESIS_NOTE_CODES: readonly string[] = [
  "A1", "A2", "A3", "A4", "A5",
  "B1", "B2", "B3", "B4", "B5",
  "C1", "C2", "C3", "C4", "C5",
  "D1", "D2", "D3", "D4", "D5",
  "E1", "E2", "E3", "E4", "E5", "E6",
  "F1", "F2", "F3",
  "G1", "G2", "G3", "G4",
  "H1", "H2", "H3", "H4",
];
