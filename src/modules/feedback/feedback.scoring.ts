// Counsellor Satisfaction Score — pure scoring per the Feedback Form Rating Methodology
// (docs/10.Class 910_Feedback Form_Rating Methodology.pdf).
//
// Student feedback is weighted 80%, parent 20%. Within each form, sections carry fixed
// weights (summing to 100%). Each section's questions are identified by their fieldKey
// prefix in the seeded feedback forms (e.g. "sse_" -> S-SE). Open-text sections have no
// numeric prefix and are naturally excluded.

export interface SectionDef {
  code: string; // e.g. "S-SE"
  label: string;
  prefix: string; // fieldKey prefix, e.g. "sse_"
  weight: number; // fraction; sections within a form sum to 1
}

export const STUDENT_SECTIONS: SectionDef[] = [
  { code: "S-SE", label: "Session Experience", prefix: "sse_", weight: 0.25 },
  { code: "S-CD", label: "Clarity & Decision Confidence", prefix: "scd_", weight: 0.35 },
  { code: "S-OQ", label: "Outcome Quality", prefix: "soq_", weight: 0.3 },
  { code: "S-OS", label: "Overall Satisfaction", prefix: "sos_", weight: 0.1 },
];

export const PARENT_SECTIONS: SectionDef[] = [
  { code: "P-PE", label: "Programme Effectiveness", prefix: "ppe_", weight: 0.15 },
  { code: "P-CE", label: "Counsellor Effectiveness", prefix: "pce_", weight: 0.35 },
  { code: "P-OA", label: "Outcome & Alignment", prefix: "poa_", weight: 0.3 },
  { code: "P-DC", label: "Decision Confidence", prefix: "pdc_", weight: 0.1 },
  { code: "P-RC", label: "Recommendation", prefix: "prc_", weight: 0.1 },
];

export const STUDENT_FORM_WEIGHT = 0.8;
export const PARENT_FORM_WEIGHT = 0.2;

export interface PerformanceBand {
  min: number; // inclusive lower bound (checked high-to-low)
  band: string;
  incentive: number; // ₹
  interpretation: string;
}

// 90-100 fully inclusive; 80-<90; 70-<80; <70. Checked high min first, so the top
// band naturally captures up to 100.
export const PERFORMANCE_BANDS: PerformanceBand[] = [
  { min: 90, band: "Top Performer", incentive: 1000, interpretation: "Consistently exceptional delivery" },
  { min: 80, band: "Strong Performer", incentive: 750, interpretation: "Strong, reliable performance" },
  { min: 70, band: "Needs Improvement", incentive: 500, interpretation: "Acceptable — targeted coaching required" },
  { min: 0, band: "Critical", incentive: 0, interpretation: "Immediate corrective action required" },
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function mapPerformanceBand(percent: number): PerformanceBand {
  for (const b of PERFORMANCE_BANDS) {
    if (percent >= b.min) return b;
  }
  return PERFORMANCE_BANDS[PERFORMANCE_BANDS.length - 1]!;
}

// Coerces a stored scale answer to a 1-5 integer, or null if it isn't a scale value.
export function parseScale(answer: unknown): number | null {
  const raw =
    typeof answer === "object" && answer !== null && "value" in answer
      ? (answer as { value: unknown }).value
      : answer;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export interface SectionScore {
  code: string;
  label: string;
  questionCount: number;
  average: number; // 1-5
  percent: number; // 0-100
}

export interface FormScore {
  sections: SectionScore[];
  scorePercent: number; // weighted across sections, 0-100
}

// Scores one form. `answers` maps fieldKey -> 1-5 value (numeric answers only).
export function scoreForm(answers: Map<string, number>, sections: SectionDef[]): FormScore {
  const scored: SectionScore[] = [];
  let weighted = 0;
  for (const section of sections) {
    const values = [...answers.entries()]
      .filter(([fieldKey]) => fieldKey.startsWith(section.prefix))
      .map(([, v]) => v);
    if (values.length === 0) {
      throw new Error(`No answers found for feedback section ${section.code}`);
    }
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const percent = (average / 5) * 100;
    weighted += percent * section.weight;
    scored.push({
      code: section.code,
      label: section.label,
      questionCount: values.length,
      average: round2(average),
      percent: round2(percent),
    });
  }
  return { sections: scored, scorePercent: round2(weighted) };
}

export interface StudentFeedbackScore {
  student: FormScore; // student form score % (weighted sections)
  parent: FormScore; // parent form score %
  finalPercent: number; // student×0.8 + parent×0.2
  band: string;
  incentive: number;
  interpretation: string;
}

// Final Score % for one student (both forms required). Steps 1-5 of the methodology.
export function computeStudentFeedback(
  studentAnswers: Map<string, number>,
  parentAnswers: Map<string, number>
): StudentFeedbackScore {
  const student = scoreForm(studentAnswers, STUDENT_SECTIONS);
  const parent = scoreForm(parentAnswers, PARENT_SECTIONS);
  const finalPercent = round2(
    student.scorePercent * STUDENT_FORM_WEIGHT + parent.scorePercent * PARENT_FORM_WEIGHT
  );
  const band = mapPerformanceBand(finalPercent);
  return {
    student,
    parent,
    finalPercent,
    band: band.band,
    incentive: band.incentive,
    interpretation: band.interpretation,
  };
}

export interface CounsellorOverall {
  overallPercent: number;
  band: string;
  incentive: number;
  interpretation: string;
}

// Step 6: average the included students' Final Score % values. null if none qualify.
export function computeCounsellorOverall(finalPercents: number[]): CounsellorOverall | null {
  if (finalPercents.length === 0) return null;
  const overallPercent = round2(
    finalPercents.reduce((a, b) => a + b, 0) / finalPercents.length
  );
  const band = mapPerformanceBand(overallPercent);
  return {
    overallPercent,
    band: band.band,
    incentive: band.incentive,
    interpretation: band.interpretation,
  };
}
