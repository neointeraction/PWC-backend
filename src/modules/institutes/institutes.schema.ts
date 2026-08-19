import { z } from "zod";
import { emailSchema, phoneSchema } from "../../common/validators/shared.js";

export const createInstituteSchema = z.object({
  name: z.string().trim().min(1),
  // Location/address is optional; stored as "" when omitted (column is NOT NULL).
  address: z.string().trim().min(1).optional(),
  contactNumber: phoneSchema,
  primaryEmail: emailSchema,
});
export type CreateInstituteInput = z.infer<typeof createInstituteSchema>;

export const updateInstituteSchema = createInstituteSchema.partial();
export type UpdateInstituteInput = z.infer<typeof updateInstituteSchema>;

export const instituteIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const createInstituteClassSchema = z.object({
  name: z.string().trim().min(1),
});
export type CreateInstituteClassInput = z.infer<typeof createInstituteClassSchema>;

export const createInstituteDivisionSchema = z.object({
  name: z.string().trim().min(1),
});
export type CreateInstituteDivisionInput = z.infer<typeof createInstituteDivisionSchema>;

export const classIdParamsSchema = z.object({
  id: z.string().cuid(),
  classId: z.string().cuid(),
});
