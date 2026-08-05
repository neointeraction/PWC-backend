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

const assessmentAnswerInputSchema = z.object({
  fieldKey: z.string().trim().min(1),
  selectedOption: z.unknown(),
});

export const saveAssessmentAnswersBodySchema = z.object({
  answers: z.array(assessmentAnswerInputSchema).min(1),
});
export type SaveAssessmentAnswersBody = z.infer<typeof saveAssessmentAnswersBodySchema>;
