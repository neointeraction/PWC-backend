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
