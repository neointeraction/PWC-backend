import { z } from "zod";

const AI_RESILIENCE_GRADES = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;
const CAREER_LIBRARY_STATUSES = ["DRAFT", "ACTIVE"] as const;

export const listCareerLibraryQuerySchema = z.object({
  // Free-text search across jobRole, cluster, industry, domain, oneLineDescription.
  search: z.string().trim().min(1).optional(),
  cluster: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1).optional(),
  domain: z.string().trim().min(1).optional(),
  aiResilienceGrade: z.enum(AI_RESILIENCE_GRADES).optional(),
  // Defaults to ACTIVE-only — callers who need drafts (e.g. Admin review) pass it explicitly.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("ACTIVE"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListCareerLibraryQuery = z.infer<typeof listCareerLibraryQuerySchema>;

export const careerLibraryIdParamsSchema = z.object({
  id: z.string().cuid(),
});
export type CareerLibraryIdParams = z.infer<typeof careerLibraryIdParamsSchema>;
