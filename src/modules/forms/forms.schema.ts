import { z } from "zod";

export const formTypeParamsSchema = z.object({
  formType: z.enum([
    "STUDENT_PROFILE",
    "PRE_COUNSELLING_STUDENT",
    "PRE_COUNSELLING_PARENT",
    "FEEDBACK_STUDENT",
    "FEEDBACK_PARENT",
  ]),
});
export type FormTypeParams = z.infer<typeof formTypeParamsSchema>;

export const formStudentParamsSchema = formTypeParamsSchema.extend({
  studentId: z.string().cuid(),
});
export type FormStudentParams = z.infer<typeof formStudentParamsSchema>;

export const getFormTemplateQuerySchema = z.object({
  cohort: z.string().trim().min(1),
  version: z.coerce.number().int().positive().optional(),
});
export type GetFormTemplateQuery = z.infer<typeof getFormTemplateQuerySchema>;

const formAnswerInputSchema = z.object({
  fieldKey: z.string().trim().min(1),
  answer: z.unknown(),
});

export const saveFormAnswersBodySchema = z.object({
  cohort: z.string().trim().min(1),
  version: z.coerce.number().int().positive().optional(),
  answers: z.array(formAnswerInputSchema).min(1),
});
export type SaveFormAnswersBody = z.infer<typeof saveFormAnswersBodySchema>;
