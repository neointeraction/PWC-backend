import { z } from "zod";

// STUDENT_PROFILE is intentionally excluded — the student profile is captured at
// student creation (POST /students), not through the forms API, so there's no seeded
// STUDENT_PROFILE template. Rejecting it here returns a clean 400 instead of a
// misleading "template not found" 404. (The Prisma `FormType` enum keeps the value.)
export const formTypeParamsSchema = z.object({
  formType: z.enum([
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

export const studentFormStatusParamsSchema = z.object({
  studentId: z.string().cuid(),
});
export type StudentFormStatusParams = z.infer<typeof studentFormStatusParamsSchema>;

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
