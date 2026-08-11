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

const noteSchema = z.object({
  code: z.enum(SYNTHESIS_NOTE_CODES as [string, ...string[]]),
  // Free text, capped at 10 lines to match the chart's "maximum 10 entry lines".
  body: z
    .string()
    .trim()
    .max(5000)
    .refine((s) => s.split("\n").length <= 10, "A synthesis note may have at most 10 lines"),
});

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
    lastEditedBy: z.string().trim().min(1),
  })
  .partial();
export type PutCounsellorChartBody = z.infer<typeof putCounsellorChartBodySchema>;
