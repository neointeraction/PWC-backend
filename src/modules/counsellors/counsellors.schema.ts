import { z } from "zod";
import { emailSchema, phoneSchema } from "../../common/validators/shared.js";

export const createCounsellorSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: emailSchema,
  mobile: phoneSchema,
  counsellorCode: z.string().trim().min(1), // admin-generated login id, e.g. "CN1"
  instituteId: z.string().cuid(),
  // Optional: assign to these projects on creation (each must belong to the institute).
  projectIds: z.array(z.string().cuid()).optional(),
});
export type CreateCounsellorInput = z.infer<typeof createCounsellorSchema>;

export const updateCounsellorSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  mobile: phoneSchema.optional(),
  isActive: z.boolean().optional(), // deactivate/reactivate the login without deleting
});
export type UpdateCounsellorInput = z.infer<typeof updateCounsellorSchema>;

export const counsellorIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listCounsellorsQuerySchema = z.object({
  instituteId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
});
export type ListCounsellorsQuery = z.infer<typeof listCounsellorsQuerySchema>;

export const assignProjectBodySchema = z.object({
  projectId: z.string().cuid(),
});
export type AssignProjectBody = z.infer<typeof assignProjectBodySchema>;

export const counsellorProjectParamsSchema = z.object({
  id: z.string().cuid(),
  projectId: z.string().cuid(),
});
