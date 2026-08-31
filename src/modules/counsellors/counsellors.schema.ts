import { z } from "zod";
import { emailSchema, phoneSchema } from "../../common/validators/shared.js";

export const createCounsellorSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: emailSchema,
  mobile: phoneSchema,
  // Auto-generated (C0001, C0002, ...) when omitted. Optional override for imports.
  counsellorCode: z.string().trim().min(1).optional(),
  password: z.string().min(1).optional(), // temp password from the import sheet; generated if omitted
  // Optional and informational only — counsellors are a flat, tenant-wide directory,
  // not scoped to a single institute. Project assignment (POST /counsellors/:id/projects)
  // never checks this field.
  instituteId: z.string().cuid().optional(),
  // Optional: assign to these projects on creation. No institute-matching required.
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
