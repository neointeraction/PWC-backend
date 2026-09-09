import { z } from "zod";
import { SYNTHESIS_NOTE_CODES } from "./fieldmap.js";

export const studentIdParamsSchema = z.object({
  studentId: z.string().cuid(),
});
export type StudentIdParams = z.infer<typeof studentIdParamsSchema>;

// Mirror-pair amendment: the counsellor changes a flagged answer (Likert 1-5), which
// re-scores the whole attempt. `questionCode` must be a mirror-pair question (validated
// in the service against the scoring config).
export const amendmentBodySchema = z.object({
  questionCode: z.string().trim().min(1),
  amendedOption: z.number().int().min(1).max(5),
  counsellorId: z.string().trim().min(1).optional(),
});
export type AmendmentBody = z.infer<typeof amendmentBodySchema>;

export const amendmentParamsSchema = z.object({
  studentId: z.string().cuid(),
  questionCode: z.string().trim().min(1),
});
export type AmendmentParams = z.infer<typeof amendmentParamsSchema>;

const scriIndicator = z.number().int().min(1).max(4);

// Roadmap grid: 9 plain free-text strings (sectionE.roadmapGrid on the frontend).
const roadmapGridSchema = z.object({
  nowSkills: z.string(),
  nowActivities: z.string(),
  nowHabits: z.string(),
  c11Stream: z.string(),
  c11Exams: z.string(),
  c11Electives: z.string(),
  afterDegrees: z.string(),
  afterCertifications: z.string(),
  afterAbroad: z.string(),
});

// Career DNA narrative: 5 plain free-text strings (sectionB.careerDnaNarrative).
const careerDnaNarrativeSchema = z.object({
  dnaDefinition: z.string(),
  careerStyleReveals: z.string(),
  personalityStyleReveals: z.string(),
  thinkingModeReveals: z.string(),
  aptitudeProfileReveals: z.string(),
});

// Why-this-stream text: sectionC.whyThisStream1/2.
const whyThisStreamSchema = z.object({
  whyThisStream1: z.string(),
  whyThisStream2: z.string(),
});

// Shapes for the Career Direction step's 6 tables. Exported so
// entrance-exams-colleges.ts can type its computed output against exactly what the
// frontend renders. `isManualEntry` marks a free-text row (not picked from the career
// library) that surfaces on the Super Admin manual-entry review queue.
export const entranceExamItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  conductingBody: z.string(),
  level: z.string(),
  applicableFor: z.string(),
  subjectRequirements: z.string(),
  examMonth: z.string(),
  urlLink: z.string(),
  isManualEntry: z.boolean().optional(),
});
export type EntranceExamItem = z.infer<typeof entranceExamItemSchema>;

export const collegesAfterItemSchema = z.object({
  id: z.string(),
  collegeName: z.string(),
  location: z.string(),
  type: z.string(),
  course: z.string(),
  entranceExam: z.string(),
  ranking: z.string(),
  website: z.string(),
  isManualEntry: z.boolean().optional(),
});
export type CollegesAfterItem = z.infer<typeof collegesAfterItemSchema>;

export const streamFitItemSchema = z.object({
  id: z.string(),
  mainStream: z.string(),
  subStream: z.string(),
  coreSubjects: z.string(),
  electives: z.string(),
  explanation: z.string().optional(),
  streamRequirement: z.string().optional(),
  gradingLevel: z.string().optional(),
  meaning: z.string().optional(),
  isManualEntry: z.boolean().optional(),
});
export type StreamFitItem = z.infer<typeof streamFitItemSchema>;

export const graduationItemSchema = z.object({
  id: z.string(),
  cluster: z.string(),
  mainStream: z.string(),
  subStream: z.string(),
  specialization: z.string(),
  reasoning: z.string(),
  keyExams: z.string(),
  isManualEntry: z.boolean().optional(),
});
export type GraduationItem = z.infer<typeof graduationItemSchema>;

export const careerCompassClusterItemSchema = z.object({
  id: z.string(),
  cluster: z.string(),
  industry: z.string(),
  domain: z.string(),
  streamRequirement: z.string(),
  gradingLevel: z.string(),
  meaning: z.string(),
  isManualEntry: z.boolean().optional(),
});
export type CareerCompassClusterItem = z.infer<typeof careerCompassClusterItemSchema>;

export const careerCompassItemSchema = z.object({
  id: z.string(),
  domain: z.string(),
  role: z.string(),
  whyItFits: z.string(),
  topEmployers: z.string(),
  aiResilience: z.string(),
  salaryIndia: z.string(),
  salaryAbroad: z.string(),
  isManualEntry: z.boolean().optional(),
});
export type CareerCompassItem = z.infer<typeof careerCompassItemSchema>;

const noteSchema = z.object({
  code: z.enum(SYNTHESIS_NOTE_CODES as [string, ...string[]]),
  // Free text, capped at 10 lines to match the chart's "maximum 10 entry lines".
  body: z
    .string()
    .trim()
    .max(5000)
    .refine((s) => s.split("\n").length <= 10, "A synthesis note may have at most 10 lines"),
});

// Finalize takes no required input — `finalizedBy` is the same optional audit stamp the
// PUT accepts as `lastEditedBy`.
export const finalizeCounsellorChartBodySchema = z
  .object({ finalizedBy: z.string().trim().min(1) })
  .partial();
export type FinalizeCounsellorChartBody = z.infer<typeof finalizeCounsellorChartBodySchema>;

export const putCounsellorChartBodySchema = z
  .object({
    strengths: z.array(z.string().trim().min(1)),
    hobbies: z.array(z.string().trim().min(1)),
    careerShortlist: z.array(z.string().trim().min(1)),
    academicTrend: z.enum(["IMPROVING", "STABLE", "DECLINING", "NOT_ASSESSED"]),
    alignmentRating: z.enum([
      "STRONGLY_ALIGNED",
      "PARTIALLY_ALIGNED",
      "MISALIGNED",
      "NOT_YET_ASSESSED",
    ]),
    scri: z
      .object({
        confidence: scriIndicator,
        reasonedThinking: scriIndicator,
        reducedAnxiety: scriIndicator,
        selfAwareness: scriIndicator,
        careerCuriosity: scriIndicator,
        decisionOwnership: scriIndicator,
      })
      .partial(),
    // Upsert notes by code; omit a code to leave it unchanged.
    notes: z.array(noteSchema),
    roadmapGrid: roadmapGridSchema,
    careerDnaNarrative: careerDnaNarrativeSchema,
    whyThisStream: whyThisStreamSchema,
    // Career Direction tables: counsellor-edited overrides. Each is the entire resulting
    // array (system rows that survived + added rows) — "last full array wins", an empty
    // array is a valid "all rows deleted" state, not an omission.
    entranceExamsTable: z.array(entranceExamItemSchema),
    collegesTable: z.array(collegesAfterItemSchema),
    streamFitTable: z.array(streamFitItemSchema),
    graduationTable: z.array(graduationItemSchema),
    careerCompassClusterTable: z.array(careerCompassClusterItemSchema),
    careerCompassTable: z.array(careerCompassItemSchema),
    lastEditedBy: z.string().trim().min(1),
  })
  .partial();
export type PutCounsellorChartBody = z.infer<typeof putCounsellorChartBodySchema>;
