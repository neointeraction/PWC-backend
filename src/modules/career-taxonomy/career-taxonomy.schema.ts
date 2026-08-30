import { z } from "zod";

// Taxonomy ids are TEXT and may be either cuid (app/seed-created) or uuid (rows backfilled by the
// normalize_career_taxonomy migration via gen_random_uuid()), so ids are validated as non-empty
// strings rather than `.cuid()`.
const id = z.string().min(1);

// `?includeDeleted=true` surfaces soft-deleted rows for admin management views. Query params are
// strings, so parse explicitly (z.coerce.boolean() would treat "false" as true).
const includeDeleted = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const taxonomyIdParamsSchema = z.object({ id });

// --- Clusters ---
export const listClustersQuerySchema = z.object({ includeDeleted });
export type ListClustersQuery = z.infer<typeof listClustersQuerySchema>;

export const createClusterSchema = z.object({ name: z.string().trim().min(1) });
export type CreateClusterInput = z.infer<typeof createClusterSchema>;

export const updateClusterSchema = z.object({ name: z.string().trim().min(1).optional() });
export type UpdateClusterInput = z.infer<typeof updateClusterSchema>;

// --- Industries ---
export const listIndustriesQuerySchema = z.object({ clusterId: id.optional(), includeDeleted });
export type ListIndustriesQuery = z.infer<typeof listIndustriesQuerySchema>;

export const createIndustrySchema = z.object({ clusterId: id, name: z.string().trim().min(1) });
export type CreateIndustryInput = z.infer<typeof createIndustrySchema>;

export const updateIndustrySchema = z.object({
  clusterId: id.optional(), // re-parent to a different cluster
  name: z.string().trim().min(1).optional(),
});
export type UpdateIndustryInput = z.infer<typeof updateIndustrySchema>;

// --- Domains ---
export const listDomainsQuerySchema = z.object({ industryId: id.optional(), includeDeleted });
export type ListDomainsQuery = z.infer<typeof listDomainsQuerySchema>;

export const createDomainSchema = z.object({ industryId: id, name: z.string().trim().min(1) });
export type CreateDomainInput = z.infer<typeof createDomainSchema>;

export const updateDomainSchema = z.object({
  industryId: id.optional(), // re-parent to a different industry
  name: z.string().trim().min(1).optional(),
});
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;

// --- Education Path (domain-level) ---
// The qualifications/programmes that lead into a domain. Held per-domain rather than per
// job role so the "add job role" form can show a tick-list of what the domain already has,
// and anything added there is inherited by every future role in that domain.
export const EDUCATION_PATH_LEVELS = [
  "CLASS_10_PLUS_2",
  "GRADUATE",
  "POST_GRADUATE",
  "CERTIFICATION_STUDENT",
  "CERTIFICATION_UG",
] as const;

// Nested under a domain for list/create; addressed directly by its own id for update/delete.
export const educationEntryIdParamsSchema = z.object({ entryId: id });
export type EducationEntryIdParams = z.infer<typeof educationEntryIdParamsSchema>;

const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const listDomainEducationQuerySchema = z.object({
  level: z.enum(EDUCATION_PATH_LEVELS).optional(),
  // The tick-list shows APPROVED only; an admin review queue passes PENDING/REJECTED.
  status: z.enum(REVIEW_STATUSES).default("APPROVED"),
  includeDeleted,
});
export type ListDomainEducationQuery = z.infer<typeof listDomainEducationQuerySchema>;

export const createDomainEducationSchema = z.object({
  level: z.enum(EDUCATION_PATH_LEVELS),
  programme: z.string().trim().min(1),
  description: z.string().trim().min(1).nullish(),
});
export type CreateDomainEducationInput = z.infer<typeof createDomainEducationSchema>;

export const updateDomainEducationSchema = z.object({
  level: z.enum(EDUCATION_PATH_LEVELS).optional(),
  programme: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullish(), // null clears it
});
export type UpdateDomainEducationInput = z.infer<typeof updateDomainEducationSchema>;

// Reject carries an optional reason back to the submitting counsellor; approve takes no body.
export const rejectDomainEducationSchema = z.object({
  rejectionReason: z.string().trim().min(1).optional(),
});
export type RejectDomainEducationInput = z.infer<typeof rejectDomainEducationSchema>;
