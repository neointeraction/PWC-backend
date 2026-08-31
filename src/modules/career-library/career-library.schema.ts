import { z } from "zod";

const AI_RESILIENCE_GRADES = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;
// Publish state shared by CareerLibraryEntry, EntranceExam, Institution, Course, and
// EducationEntry. Mirrors the prisma `CareerLibraryStatus` enum. A counsellor-submitted job
// role never reaches career_library_entries at all (see `CareerLibraryEntryProposal`), so
// unlike the other four tables this one has no PENDING-equivalent queue built from a status
// filter — that's GET /career-library/proposals instead.
const CAREER_LIBRARY_STATUSES = ["DRAFT", "ACTIVE"] as const;

export const listCareerLibraryQuerySchema = z.object({
  // Free-text search across jobRole, oneLineDescription, and the taxonomy names.
  search: z.string().trim().min(1).optional(),
  // Taxonomy filters by id (any level; ids may be cuid or uuid — see career-taxonomy.schema).
  clusterId: z.string().min(1).optional(),
  industryId: z.string().min(1).optional(),
  domainId: z.string().min(1).optional(),
  aiResilienceGrade: z.enum(AI_RESILIENCE_GRADES).optional(),
  // Defaults to ACTIVE-only — callers who need drafts (e.g. an admin's own WIP entries)
  // pass it explicitly.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("ACTIVE"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListCareerLibraryQuery = z.infer<typeof listCareerLibraryQuerySchema>;

// --- Job role proposals (counsellor submits, admin reviews) ---
export const listCareerEntryProposalsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  domainId: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListCareerEntryProposalsQuery = z.infer<typeof listCareerEntryProposalsQuerySchema>;

export const careerLibraryIdParamsSchema = z.object({
  id: z.string().cuid(),
});
export type CareerLibraryIdParams = z.infer<typeof careerLibraryIdParamsSchema>;

// --- Entry writes (staff) ---
// An admin's create is live as submitted; a counsellor's is the same payload but lands
// PENDING review + DRAFT, and only an admin's approve puts it in the library.

const QUALIFICATION_LEVELS = ["UG", "PG"] as const;
// Mirrors the prisma `EducationPathLevel` enum (10+2 / Graduate / Post-Graduate /
// Certification-Student / Certification-UG).
const EDUCATION_PATH_LEVELS = [
  "CLASS_10_PLUS_2",
  "GRADUATE",
  "POST_GRADUATE",
  "CERTIFICATION_STUDENT",
  "CERTIFICATION_UG",
] as const;

// A normalized link item is EITHER an existing lookup row (`{ id }`) OR a new one to
// find-or-create (`{ name, ... }`) — "select existing or add new". Exactly one of id/name.
//
// The detail fields below carry the rest of the admin "add new" form so a hand-added
// canonical row lands as complete as an imported one. They apply only to a `{ name, ... }`
// item, and only to columns that are still BLANK on a row that already exists — an inline
// add while editing one job role must never overwrite reference data other roles share.
// Websites are plain strings, not `.url()`: the source data holds bare hosts like
// "www.nta.ac.in" and rejecting those would be worse than storing them.
const detail = z.string().trim().min(1).optional();

export const examLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    name: z.string().trim().min(1).optional(),
    level: z.enum(QUALIFICATION_LEVELS).optional(),
    fullForm: detail,
    conductingBody: detail,
    officialWebsite: detail,
    examMode: detail,
    frequency: detail,
    applicableFor: detail,
    subjectRequirements12th: detail,
    applicationWindow: detail,
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.name), { message: "Provide exactly one of id or name" })
  .refine((v) => !v.name || v.level, { message: "level (UG|PG) is required when adding an exam by name" });

export const courseLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    name: z.string().trim().min(1).optional(),
    level: z.enum(QUALIFICATION_LEVELS).optional(), // defaults to UG in the service
    fullForm: detail,
    durationYears: detail,
    stream12thRequirements: detail,
    relevantEntranceExams: detail,
    programmesOffered: detail,
    topColleges: detail,
    furtherStudyOptions: detail,
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.name), { message: "Provide exactly one of id or name" });

export const institutionLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    name: z.string().trim().min(1).optional(),
    shortName: detail,
    city: detail,
    state: detail,
    type: detail,
    website: detail,
    entranceExamsRequired: detail,
    programmesOffered: detail,
    ranking: detail,
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.name), { message: "Provide exactly one of id or name" });

// Education Path items are global canonical rows (see prisma `EducationEntry`), like exams /
// courses / institutions: a `{ level, programme }` item is find-or-created once and reused by
// every job role that names it, and an `{ id }` may be any live entry regardless of domain.
export const educationLinkItemSchema = z
  .object({
    id: z.string().cuid().optional(),
    level: z.enum(EDUCATION_PATH_LEVELS).optional(),
    programme: z.string().trim().min(1).optional(),
    description: detail,
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.programme), {
    message: "Provide exactly one of id or programme",
  })
  .refine((v) => !v.programme || v.level, {
    message: "level is required when adding an education entry by programme",
  });

export type ExamLinkItem = z.infer<typeof examLinkItemSchema>;
export type CourseLinkItem = z.infer<typeof courseLinkItemSchema>;
export type InstitutionLinkItem = z.infer<typeof institutionLinkItemSchema>;
export type EducationLinkItem = z.infer<typeof educationLinkItemSchema>;

export const createCareerEntrySchema = z.object({
  // Leaf of the Cluster → Industry → Domain taxonomy; must reference a live CareerDomain
  // (validated in the service). cluster/industry are derived by walking up.
  domainId: z.string().min(1),
  jobRole: z.string().trim().min(1),
  aiResilienceGrade: z.enum(AI_RESILIENCE_GRADES),
  aiResilienceComment: z.string().trim().min(1),
  oneLineDescription: z.string().trim().min(1),
  // Longer-form editorial fields (yellow workbook columns).
  roleOverview: z.string().trim().min(1).nullish(),
  keySkills: z.array(z.string().trim().min(1)).default([]),
  topCompanies: z.array(z.string().trim().min(1)).default([]),
  salaryIndiaRangeText: z.string().trim().min(1).nullish(),
  salaryIndiaMinLPA: z.number().nullish(),
  salaryIndiaMaxLPA: z.number().nullish(),
  salaryGlobalRangeText: z.string().trim().min(1).nullish(),
  salaryGlobalMinUSD: z.number().nullish(),
  salaryGlobalMaxUSD: z.number().nullish(),
  qualification10th12th: z.string().trim().min(1).nullish(),
  qualification10th12thExplanation: z.string().trim().min(1).nullish(),
  qualificationGraduation: z.string().trim().min(1).nullish(),
  qualificationGraduationDefined: z.string().trim().min(1).nullish(),
  qualificationPG: z.string().trim().min(1).nullish(),
  qualificationPGDefined: z.string().trim().min(1).nullish(),
  entranceExamsUGDescription: z.string().trim().min(1).nullish(),
  certificationsStudent: z.array(z.string().trim().min(1)).default([]),
  certificationsUG: z.array(z.string().trim().min(1)).default([]),
  // Normalized "select existing or add new" links (each item is { id } or { name, ... }).
  // `entranceExams` is a single list carrying UG/PG per item; `courses` replaces the old
  // topCourses; `institutions` (colleges) are curated per job role.
  entranceExams: z.array(examLinkItemSchema).default([]),
  courses: z.array(courseLinkItemSchema).default([]),
  institutions: z.array(institutionLinkItemSchema).default([]),
  // Domain-level Education Path (see `educationLinkItemSchema`).
  educationEntries: z.array(educationLinkItemSchema).default([]),
  // New entries default to DRAFT — an admin flips them to ACTIVE (the "ratify"/publish
  // step) once reviewed. ACTIVE-on-create is allowed for trusted bulk additions, but only
  // for an admin: a counsellor posting this same payload never reaches this table at all —
  // the service stages it as a CareerLibraryEntryProposal instead, where `status` is ignored.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("DRAFT"),
});
export type CreateCareerEntryInput = z.infer<typeof createCareerEntrySchema>;

// All fields optional for a partial update; `status` here is the publish/unpublish toggle.
// A provided link array REPLACES that entry's links; omitting it leaves them unchanged.
// Omitting a scalar leaves it unchanged; sending `null` CLEARS it (nullable columns only —
// see `.nullish()` above). Empty strings stay rejected: clear with null, not an empty string.
export const updateCareerEntrySchema = createCareerEntrySchema.partial();
export type UpdateCareerEntryInput = z.infer<typeof updateCareerEntrySchema>;

// --- Dropdown / typeahead lookups (feed the "select existing" multiselects) ---

export const listEntranceExamsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  // Pickers show ACTIVE rows only; pass DRAFT to review what's not published yet.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("ACTIVE"),
  level: z.enum(QUALIFICATION_LEVELS).optional(),
  // Scope to exams/courses/institutions already linked to job roles in this domain
  // (the "existing entries pulled from this Domain" tick-list). Omit for the global list.
  domainId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListEntranceExamsQuery = z.infer<typeof listEntranceExamsQuerySchema>;

export const listInstitutionsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  // Pickers show ACTIVE rows only; pass DRAFT to review what's not published yet.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("ACTIVE"),
  // Scope to exams/courses/institutions already linked to job roles in this domain
  // (the "existing entries pulled from this Domain" tick-list). Omit for the global list.
  domainId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListInstitutionsQuery = z.infer<typeof listInstitutionsQuerySchema>;

export const listCoursesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  // Pickers show ACTIVE rows only; pass DRAFT to review what's not published yet.
  status: z.enum(CAREER_LIBRARY_STATUSES).default("ACTIVE"),
  level: z.enum(QUALIFICATION_LEVELS).optional(),
  // Scope to exams/courses/institutions already linked to job roles in this domain
  // (the "existing entries pulled from this Domain" tick-list). Omit for the global list.
  domainId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;

// --- Education Path (global canonical lookup) ---
// The qualifications/programmes that lead into a career. Like exams/courses/institutions
// these are global rows attached to job roles through a join table — `domainId` here
// scopes the picker by *usage* (entries already linked to roles in that domain), not by
// ownership.
export const educationEntryIdParamsSchema = z.object({ entryId: z.string().min(1) });
export type EducationEntryIdParams = z.infer<typeof educationEntryIdParamsSchema>;

const EDUCATION_STATUSES = ["DRAFT", "ACTIVE"] as const;

export const listEducationEntriesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  level: z.enum(EDUCATION_PATH_LEVELS).optional(),
  // Pickers show ACTIVE rows only; pass DRAFT to review what's not published yet.
  status: z.enum(EDUCATION_STATUSES).default("ACTIVE"),
  // Scope to entries already linked to job roles in this domain. Omit for the global list.
  domainId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListEducationEntriesQuery = z.infer<typeof listEducationEntriesQuerySchema>;

export const createEducationEntrySchema = z.object({
  level: z.enum(EDUCATION_PATH_LEVELS),
  programme: z.string().trim().min(1),
  description: z.string().trim().min(1).nullish(),
  // Defaults by role: ACTIVE for an admin, DRAFT for a counsellor. Pass it to override.
  status: z.enum(EDUCATION_STATUSES).optional(),
});
export type CreateEducationEntryInput = z.infer<typeof createEducationEntrySchema>;

export const updateEducationEntrySchema = z.object({
  level: z.enum(EDUCATION_PATH_LEVELS).optional(),
  programme: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullish(), // null clears it
  // This is the publish step: flip a DRAFT entry to ACTIVE to put it in the pickers.
  status: z.enum(EDUCATION_STATUSES).optional(),
});
export type UpdateEducationEntryInput = z.infer<typeof updateEducationEntrySchema>;

// --- Standalone reference-data submissions (counsellor proposes, admin reviews) ---
// Same shape as the inline "add new" link items, minus the `id` branch: this path always
// creates (or re-proposes) a row. A counsellor's submission lands PENDING; an admin's is
// APPROVED on the spot. Reuses `detail` so the field set can't drift from the link items.

export const lookupIdParamsSchema = z.object({ id: z.string().cuid() });
export type LookupIdParams = z.infer<typeof lookupIdParamsSchema>;

export const submitEntranceExamSchema = z.object({
  name: z.string().trim().min(1),
  level: z.enum(QUALIFICATION_LEVELS),
  fullForm: detail,
  conductingBody: detail,
  officialWebsite: detail,
  examMode: detail,
  frequency: detail,
  applicableFor: detail,
  subjectRequirements12th: detail,
  applicationWindow: detail,
});
export type SubmitEntranceExamInput = z.infer<typeof submitEntranceExamSchema>;

export const submitCourseSchema = z.object({
  name: z.string().trim().min(1),
  level: z.enum(QUALIFICATION_LEVELS).default("UG"),
  fullForm: detail,
  durationYears: detail,
  stream12thRequirements: detail,
  relevantEntranceExams: detail,
  programmesOffered: detail,
  topColleges: detail,
  furtherStudyOptions: detail,
});
export type SubmitCourseInput = z.infer<typeof submitCourseSchema>;

export const submitInstitutionSchema = z.object({
  name: z.string().trim().min(1),
  shortName: detail,
  city: detail,
  state: detail,
  type: detail,
  website: detail,
  entranceExamsRequired: detail,
  programmesOffered: detail,
  ranking: detail,
});
export type SubmitInstitutionInput = z.infer<typeof submitInstitutionSchema>;

// Reject hard-deletes the row (no REJECTED-but-kept state), so there's nothing to carry in
// the body — same as approve.
