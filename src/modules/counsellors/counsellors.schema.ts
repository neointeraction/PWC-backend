import { z } from "zod";
import { emailSchema, phoneSchema } from "../../common/validators/shared.js";

export const createCounsellorSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: emailSchema,
  mobile: phoneSchema,
  // Admin-supplied human-readable login id (e.g. "C0001"). Required — no longer generated
  // by the service.
  counsellorCode: z.string().trim().min(1),
  password: z.string().min(1).optional(), // temp password from the import sheet; generated if omitted
  // Optional: assign to these projects on creation.
  projectIds: z.array(z.string().cuid()).optional(),
  // The counsellor's one fixed meeting room (e.g. their own Zoom/Meet room). Every
  // session assigned to this counsellor uses this same link — sessions don't have their
  // own link anymore (see Session.counsellor.meetingLink).
  meetingLink: z.string().trim().url().optional(),
});
export type CreateCounsellorInput = z.infer<typeof createCounsellorSchema>;

export const updateCounsellorSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  mobile: phoneSchema.optional(),
  isActive: z.boolean().optional(), // deactivate/reactivate the login without deleting
  // Send null to clear a previously-set default link.
  meetingLink: z.string().trim().url().nullable().optional(),
});
export type UpdateCounsellorInput = z.infer<typeof updateCounsellorSchema>;

export const counsellorIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listCounsellorsQuerySchema = z.object({
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
