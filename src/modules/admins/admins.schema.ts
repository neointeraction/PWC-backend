import { z } from "zod";
import { emailSchema } from "../../common/validators/shared.js";

// The two "App Admin" roles this module manages. SUPER_ADMIN is intentionally excluded —
// this module can neither create super admins nor escalate an admin to one.
export const appAdminRoleSchema = z.enum(["ADMIN", "VIEW_ONLY_ADMIN"]);

export const createAdminSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: emailSchema,
  // The view-only toggle: VIEW_ONLY_ADMIN = read-only app admin. Defaults to full ADMIN.
  role: appAdminRoleSchema.default("ADMIN"),
});
export type CreateAdminInput = z.infer<typeof createAdminSchema>;

export const updateAdminSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  role: appAdminRoleSchema.optional(), // flip ADMIN <-> VIEW_ONLY_ADMIN
  isActive: z.boolean().optional(), // deactivate/reactivate the login without deleting
});
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;

export const adminIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listAdminsQuerySchema = z.object({
  role: appAdminRoleSchema.optional(),
});
export type ListAdminsQuery = z.infer<typeof listAdminsQuerySchema>;
