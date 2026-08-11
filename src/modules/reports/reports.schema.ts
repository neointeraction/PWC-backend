import { z } from "zod";

export const reportStudentParamsSchema = z.object({
  studentId: z.string().cuid(),
});
export type ReportStudentParams = z.infer<typeof reportStudentParamsSchema>;
