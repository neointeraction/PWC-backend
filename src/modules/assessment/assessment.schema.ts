import { z } from "zod";

export const listAssessmentQuestionsQuerySchema = z.object({
  cohort: z.string().trim().min(1),
  section: z.enum(["RIASEC", "BIG_FIVE", "APTITUDE", "COGNITIVE"]).optional(),
});
export type ListAssessmentQuestionsQuery = z.infer<typeof listAssessmentQuestionsQuerySchema>;
