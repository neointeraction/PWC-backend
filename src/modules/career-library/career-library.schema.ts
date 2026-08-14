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

const QUALIFICATION_LEVELS = ["UG", "PG"] as const;

// A normalized link item is EITHER an existing lookup row (`{ id }`) OR a new one to
// find-or-create (`{ name, ... }`) — "select existing or add new". Exactly one of id/name.
export const examLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    name: z.string().trim().min(1).optional(),
    level: z.enum(QUALIFICATION_LEVELS).optional(),
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.name), { message: "Provide exactly one of id or name" })
  .refine((v) => !v.name || v.level, { message: "level (UG|PG) is required when adding an exam by name" });

export const courseLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    name: z.string().trim().min(1).optional(),
    level: z.enum(QUALIFICATION_LEVELS).optional(), // defaults to UG in the service
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.name), { message: "Provide exactly one of id or name" });

export const institutionLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    name: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    state: z.string().trim().min(1).optional(),
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.name), { message: "Provide exactly one of id or name" });

export type ExamLinkItem = z.infer<typeof examLinkItemSchema>;
export type CourseLinkItem = z.infer<typeof courseLinkItemSchema>;
export type InstitutionLinkItem = z.infer<typeof institutionLinkItemSchema>;

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
  certificationsStudent: z.array(z.string().trim().min(1)).default([]),
  certificationsUG: z.array(z.string().trim().min(1)).default([]),
  // Normalized "select existing or add new" links (each item is { id } or { name, ... }).
  // `entranceExams` is a single list carrying UG/PG per item; `courses` replaces the old
  // topCourses; `institutions` (colleges) are curated per job role.
  entranceExams: z.array(examLinkItemSchema).default([]),
  courses: z.array(courseLinkItemSchema).default([]),
  institutions: z.array(institutionLinkItemSchema).default([]),
  // New entries default to DRAFT — an admin flips them to ACTIVE (the "ratify"/publish
  // step) once reviewed. ACTIVE-on-create is allowed for trusted bulk additions.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("DRAFT"),
});
export type CreateCareerEntryInput = z.infer<typeof createCareerEntrySchema>;

// All fields optional for a partial update; `status` here is the publish/unpublish toggle.
// A provided link array REPLACES that entry's links; omitting it leaves them unchanged.
export const updateCareerEntrySchema = createCareerEntrySchema.partial();
export type UpdateCareerEntryInput = z.infer<typeof updateCareerEntrySchema>;

// --- Dropdown / typeahead lookups (feed the "select existing" multiselects) ---

export const listEntranceExamsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  level: z.enum(QUALIFICATION_LEVELS).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListEntranceExamsQuery = z.infer<typeof listEntranceExamsQuerySchema>;

export const listInstitutionsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListInstitutionsQuery = z.infer<typeof listInstitutionsQuerySchema>;

export const listCoursesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  level: z.enum(QUALIFICATION_LEVELS).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;

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
