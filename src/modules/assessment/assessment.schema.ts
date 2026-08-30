import { z } from "zod";

export const listAssessmentQuestionsQuerySchema = z.object({
  cohort: z.string().trim().min(1),
  section: z.enum(["RIASEC", "BIG_FIVE", "APTITUDE", "COGNITIVE"]).optional(),
});
export type ListAssessmentQuestionsQuery = z.infer<typeof listAssessmentQuestionsQuerySchema>;

export const startAttemptBodySchema = z.object({
  studentId: z.string().cuid(),
  cohort: z.string().trim().min(1),
});
export type StartAttemptBody = z.infer<typeof startAttemptBodySchema>;

export const attemptIdParamsSchema = z.object({
  attemptId: z.string().cuid(),
});
export type AttemptIdParams = z.infer<typeof attemptIdParamsSchema>;

// `timeTakenMs` is the per-question elapsed time. It is optional: omit it and any
// previously saved value is left untouched; send `null` to clear one. The aptitude Time
// Consistency component (and therefore the composite ARI) only activates once every
// aptitude answer carries a value — see src/modules/assessment/scoring/ari.ts.
const assessmentAnswerInputSchema = z.object({
  fieldKey: z.string().trim().min(1),
  selectedOption: z.unknown(),
  timeTakenMs: z.number().int().nonnegative().nullable().optional(),
});

export const saveAssessmentAnswersBodySchema = z.object({
  answers: z.array(assessmentAnswerInputSchema).min(1),
});
export type SaveAssessmentAnswersBody = z.infer<typeof saveAssessmentAnswersBodySchema>;

// Dev/QA score-preview: run the scoring engine over ad-hoc answers with no student,
// attempt, or persistence. Answers may be partial (unanswered questions score as
// neutral/incorrect). `response` is the raw Likert value ("1".."5") or MCQ letter
// ("A".."E"); `durationMinutes` feeds the completion-time (ORI) band (default 30).
export const previewScoreBodySchema = z.object({
  cohort: z.string().trim().min(1),
  durationMinutes: z.coerce.number().positive().max(600).optional(),
  answers: z
    .array(
      z.object({
        fieldKey: z.string().trim().min(1),
        response: z.union([z.string(), z.number()]).nullable().optional(),
        // Optional per-question elapsed time, so the dev tester can exercise TC/ARI
        // without a real attempt. ARI stays null unless every aptitude item has one.
        timeTakenMs: z.number().int().nonnegative().nullable().optional(),
      })
    )
    .default([]),
});
export type PreviewScoreBody = z.infer<typeof previewScoreBodySchema>;
