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

// --- Entry writes (admin/super admin) ---

export const createCareerEntrySchema = z.object({
  cluster: z.string().trim().min(1),
  industry: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  jobRole: z.string().trim().min(1),
  aiResilienceGrade: z.enum(AI_RESILIENCE_GRADES),
  aiResilienceComment: z.string().trim().min(1),
  oneLineDescription: z.string().trim().min(1),
  topCompanies: z.array(z.string().trim().min(1)).default([]),
  salaryIndiaRangeText: z.string().trim().min(1).optional(),
  salaryIndiaMinLPA: z.number().optional(),
  salaryIndiaMaxLPA: z.number().optional(),
  salaryGlobalRangeText: z.string().trim().min(1).optional(),
  salaryGlobalMinUSD: z.number().optional(),
  salaryGlobalMaxUSD: z.number().optional(),
  qualification10th12th: z.string().trim().min(1),
  qualificationGraduation: z.string().trim().min(1).optional(),
  qualificationPG: z.string().trim().min(1).optional(),
  entranceExamsUGDescription: z.string().trim().min(1).optional(),
  entranceExams: z.array(z.string().trim().min(1)).default([]),
  entranceExamsPG: z.array(z.string().trim().min(1)).default([]),
  certificationsStudent: z.array(z.string().trim().min(1)).default([]),
  certificationsUG: z.array(z.string().trim().min(1)).default([]),
  topCourses: z.array(z.string().trim().min(1)).default([]),
  // New entries default to DRAFT — an admin flips them to ACTIVE (the "ratify"/publish
  // step) once reviewed. ACTIVE-on-create is allowed for trusted bulk additions.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("DRAFT"),
});
export type CreateCareerEntryInput = z.infer<typeof createCareerEntrySchema>;

// All fields optional for a partial update; `status` here is the publish/unpublish toggle.
export const updateCareerEntrySchema = createCareerEntrySchema.partial();
export type UpdateCareerEntryInput = z.infer<typeof updateCareerEntrySchema>;

// --- Ratification requests (counsellor-submitted, admin-reviewed) ---

const CAREER_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const createCareerRequestSchema = z.object({
  // Counsellors are resolved from their auth token; an admin filing on behalf of a
  // counsellor supplies the counsellor id explicitly.
  requestedById: z.string().cuid().optional(),
  jobTitle: z.string().trim().min(1),
  suggestedCluster: z.string().trim().min(1),
  suggestedIndustry: z.string().trim().min(1),
  suggestedDomain: z.string().trim().min(1).optional(),
  oneLineDescription: z.string().trim().min(1),
  justification: z.string().trim().min(1),
  referenceLinks: z.array(z.string().url()).default([]),
});
export type CreateCareerRequestInput = z.infer<typeof createCareerRequestSchema>;

export const listCareerRequestsQuerySchema = z.object({
  status: z.enum(CAREER_REQUEST_STATUSES).optional(),
  requestedById: z.string().cuid().optional(),
});
export type ListCareerRequestsQuery = z.infer<typeof listCareerRequestsQuerySchema>;

export const careerRequestIdParamsSchema = z.object({
  requestId: z.string().cuid(),
});
export type CareerRequestIdParams = z.infer<typeof careerRequestIdParamsSchema>;

// Approve may link the request to the entry the admin created from it.
export const approveCareerRequestSchema = z.object({
  resultingEntryId: z.string().cuid().optional(),
});
export type ApproveCareerRequestInput = z.infer<typeof approveCareerRequestSchema>;
