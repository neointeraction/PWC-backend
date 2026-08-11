import { z } from "zod";

export const studentIdParamsSchema = z.object({
  studentId: z.string().cuid(),
});
export type StudentIdParams = z.infer<typeof studentIdParamsSchema>;

export const counsellorIdParamsSchema = z.object({
  counsellorId: z.string().cuid(),
});
export type CounsellorIdParams = z.infer<typeof counsellorIdParamsSchema>;
