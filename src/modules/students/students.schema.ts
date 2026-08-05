import { z } from "zod";
import { emailSchema, phoneSchema } from "../../common/validators/shared.js";

export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: emailSchema,
  mobile: phoneSchema,
  whatsappNumber: phoneSchema.optional(),
  studentCode: z.string().trim().min(1), // admin-generated login id, e.g. "CB1"
  projectId: z.string().cuid(),
  divisionId: z.string().cuid(),
  parentMobile: phoneSchema,
  parentEmail: emailSchema,
  fatherName: z.string().trim().min(1),
  fatherOccupation: z.string().trim().min(1),
  fatherEmployer: z.string().trim().min(1).optional(),
  motherName: z.string().trim().min(1),
  motherOccupation: z.string().trim().min(1),
  motherEmployer: z.string().trim().min(1).optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  mobile: phoneSchema.optional(),
  whatsappNumber: phoneSchema.optional(),
  divisionId: z.string().cuid().optional(),
  parentMobile: phoneSchema.optional(),
  parentEmail: emailSchema.optional(),
  fatherName: z.string().trim().min(1).optional(),
  fatherOccupation: z.string().trim().min(1).optional(),
  fatherEmployer: z.string().trim().min(1).optional(),
  motherName: z.string().trim().min(1).optional(),
  motherOccupation: z.string().trim().min(1).optional(),
  motherEmployer: z.string().trim().min(1).optional(),
});
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const studentIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listStudentsQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  divisionId: z.string().cuid().optional(),
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
