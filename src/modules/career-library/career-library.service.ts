import { Prisma } from "@prisma/client";
import type { CareerLibraryStatus, EducationPathLevel, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { assertLiveDomain } from "../career-taxonomy/career-taxonomy.service.js";
import type {
  CourseLinkItem,
  CreateCareerEntryInput,
  EducationLinkItem,
  ExamLinkItem,
  InstitutionLinkItem,
  ListCareerEntryProposalsQuery,
  ListCareerLibraryQuery,
  ListCoursesQuery,
  ListEducationEntriesQuery,
  CreateEducationEntryInput,
  UpdateEducationEntryInput,
  ListEntranceExamsQuery,
  ListInstitutionsQuery,
  SubmitCourseInput,
  SubmitEntranceExamInput,
  SubmitInstitutionInput,
  UpdateCareerEntryInput,
  UpdateCourseInput,
  UpdateEntranceExamInput,
  UpdateInstitutionInput,
} from "./career-library.schema.js";

// The authenticated actor performing a write (from the access token).
export interface Actor {
  userId: string;
  role: UserRole;
}

const isAdmin = (actor: Actor): boolean => actor.role === "ADMIN" || actor.role === "SUPER_ADMIN";

// Publish state for a reference row this actor is creating. An admin's addition is live
// (ACTIVE) immediately; a counsellor's lands DRAFT and is hidden from the pickers.
function reviewOnCreate(actor: Actor) {
  return isAdmin(actor)
    ? { status: "ACTIVE" as const, submittedBy: actor.userId }
    : { status: "DRAFT" as const, submittedBy: actor.userId };
}

// What to do when a find-or-create lands on a row that already exists: an admin naming a
// row a counsellor proposed is an implicit publish. Otherwise leave the status alone.
function reviewOnReuse(existing: { status: CareerLibraryStatus }, actor: Actor) {
  if (existing.status === "DRAFT" && isAdmin(actor)) {
    return { status: "ACTIVE" as const };
  }
  return {};
}

// Flattens the domain → industry → cluster chain onto each entry so responses still carry the
// cluster/industry/domain names (as {id,name} objects), now that they're normalized.
const domainChainInclude = {
  domain: {
    select: {
      id: true,
      name: true,
      industry: {
        select: { id: true, name: true, cluster: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.CareerLibraryEntryInclude;

const domainChainSelect = {
  id: true,
  name: true,
  industry: {
    select: { id: true, name: true, cluster: { select: { id: true, name: true } } },
  },
} satisfies Prisma.CareerDomainSelect;

export async function listCareerLibraryEntries(query: ListCareerLibraryQuery) {
  const search = query.search;
  // Taxonomy filters at any level, traversed through the leaf domain relation. Merged into one
  // `domain` filter so combining industryId + clusterId ANDs them (rather than colliding on key).
  const domainFilter: Prisma.CareerDomainWhereInput = {};
  if (query.industryId) domainFilter.industryId = query.industryId;
  if (query.clusterId) domainFilter.industry = { clusterId: query.clusterId };

  const where: Prisma.CareerLibraryEntryWhereInput = {
    status: query.status,
    aiResilienceGrade: query.aiResilienceGrade,
    ...(query.domainId ? { domainId: query.domainId } : {}),
    ...(Object.keys(domainFilter).length ? { domain: domainFilter } : {}),
    ...(search
      ? {
          OR: [
            { jobRole: { contains: search, mode: "insensitive" } },
            { oneLineDescription: { contains: search, mode: "insensitive" } },
            { domain: { name: { contains: search, mode: "insensitive" } } },
            { domain: { industry: { name: { contains: search, mode: "insensitive" } } } },
            { domain: { industry: { cluster: { name: { contains: search, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.careerLibraryEntry.count({ where }),
    prisma.careerLibraryEntry.findMany({
      where,
      include: domainChainInclude,
      orderBy: [
        { domain: { industry: { cluster: { name: "asc" } } } },
        { jobRole: "asc" },
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: entries,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

// Filter-dropdown source, now backed by the taxonomy tables (live rows only). Each level is
// returned as {id, name} objects (the list endpoint filters by id). Industries/domains carry their
// parent id so the frontend can cascade. For a fully nested picker, use GET /career-taxonomy/tree.
export async function getCareerLibraryFilters() {
  const [clusters, industries, domains] = await Promise.all([
    prisma.careerCluster.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.careerIndustry.findMany({
      where: { deletedAt: null, cluster: { deletedAt: null } },
      select: { id: true, name: true, clusterId: true },
      orderBy: { name: "asc" },
    }),
    prisma.careerDomain.findMany({
      where: { deletedAt: null, industry: { deletedAt: null, cluster: { deletedAt: null } } },
      select: { id: true, name: true, industryId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    clusters,
    industries,
    domains,
    aiResilienceGrades: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"],
  };
}

// Detail view surfaces the cross-table mapping (see docs/db-design.md "Career Library
// workbook import"): related UG institutions by industry, UG courses by cluster, and
// UG entrance exams by the extracted exam-name list. Plain value matches, not FKs.
// Selects the curated normalized links (the per-career exams/courses/colleges), flattened
// onto the entry as `linkedEntranceExams` / `linkedCourses` / `linkedInstitutions`.
const entranceExamDetailSelect = {
  id: true,
  name: true,
  level: true,
  fullForm: true,
  conductingBody: true,
  officialWebsite: true,
  examMode: true,
  frequency: true,
  applicableFor: true,
  subjectRequirements12th: true,
  applicationWindow: true,
  status: true,
  submittedBy: true,
} satisfies Prisma.EntranceExamSelect;

const courseDetailSelect = {
  id: true,
  name: true,
  level: true,
  fullForm: true,
  durationYears: true,
  stream12thRequirements: true,
  relevantEntranceExams: true,
  programmesOffered: true,
  topColleges: true,
  furtherStudyOptions: true,
  status: true,
  submittedBy: true,
} satisfies Prisma.CourseSelect;

const institutionDetailSelect = {
  id: true,
  name: true,
  shortName: true,
  city: true,
  state: true,
  type: true,
  website: true,
  entranceExamsRequired: true,
  programmesOffered: true,
  ranking: true,
  status: true,
  submittedBy: true,
} satisfies Prisma.InstitutionSelect;

const entryLinkInclude = {
  ...domainChainInclude,
  entranceExamLinks: {
    select: { entranceExam: { select: entranceExamDetailSelect } },
    orderBy: { entranceExam: { name: "asc" } },
  },
  courseLinks: {
    select: { course: { select: courseDetailSelect } },
    orderBy: { course: { name: "asc" } },
  },
  institutionLinks: {
    select: { institution: { select: institutionDetailSelect } },
    orderBy: { institution: { name: "asc" } },
  },
  educationLinks: {
    select: {
      educationEntry: { select: { id: true, level: true, programme: true, description: true, status: true } },
    },
    orderBy: { educationEntry: { programme: "asc" } },
  },
} satisfies Prisma.CareerLibraryEntryInclude;

export async function getCareerLibraryEntryById(id: string) {
  const entry = await prisma.careerLibraryEntry.findUnique({
    where: { id },
    include: entryLinkInclude,
  });
  if (!entry) {
    throw new NotFoundError("Career library entry not found");
  }
  const { entranceExamLinks, courseLinks, institutionLinks, educationLinks, ...rest } = entry;

  const [relatedInstitutions, relatedCourses, relatedEntranceExams] = await Promise.all([
    prisma.ugInstitution.findMany({
      where: { industry: entry.domain.industry.name },
      orderBy: { name: "asc" },
    }),
    prisma.ugCourse.findMany({
      where: { careerCluster: entry.domain.industry.cluster.name },
      orderBy: { courseName: "asc" },
    }),
    entry.entranceExams.length > 0
      ? prisma.ugEntranceExam.findMany({
          where: { examName: { in: entry.entranceExams } },
          orderBy: { examName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return {
    ...rest,
    // Curated per-career links (normalized) — the primary source going forward.
    linkedEntranceExams: entranceExamLinks.map((l) => l.entranceExam),
    linkedCourses: courseLinks.map((l) => l.course),
    linkedInstitutions: institutionLinks.map((l) => l.institution),
    // Domain-level Education Path. A soft-deleted path entry stays linked (so an existing
    // role keeps rendering) but is filtered out of the domain's picker — see career-taxonomy.
    linkedEducationEntries: educationLinks.map((l) => l.educationEntry),
    // Legacy broad value-match view (industry/cluster) — kept during the transition.
    relatedInstitutions,
    relatedCourses,
    relatedEntranceExams,
  };
}

// --- Entry writes (admin/super admin) ------------------------------------------

// --- "Select existing or add new" resolvers: map link items -> canonical rows,
// find-or-creating the `{ name, ... }` ones and validating the `{ id }` ones. ---

type ResolvedExam = { id: string; name: string; level: "UG" | "PG" };
type ResolvedCourse = { id: string; name: string; level: "UG" | "PG" };
type ResolvedInstitution = { id: string; name: string };
type ResolvedEducationEntry = { id: string; level: EducationPathLevel; programme: string };

// Detail fields on a `{ name, ... }` item fill only columns that are still blank on a row
// that already exists. Canonical rows are shared across job roles, so an inline add while
// editing one role must not clobber another's reference data; correcting a wrong value is
// a deliberate edit of the canonical row, not a side effect of linking it.
async function fillBlanks<T extends Record<string, unknown>>(
  existing: T,
  detail: Record<string, unknown>,
  update: (data: Record<string, unknown>) => Promise<T>,
  extra: Record<string, unknown> = {}
): Promise<T> {
  const patch: Record<string, unknown> = { ...extra };
  for (const [key, value] of Object.entries(detail)) {
    if (value !== undefined && existing[key] == null) patch[key] = value;
  }
  return Object.keys(patch).length > 0 ? update(patch) : existing;
}

async function resolveEntranceExams(items: ExamLinkItem[], actor: Actor): Promise<ResolvedExam[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedExam>();
  for (const it of items) {
    if (it.id) continue;
    const { id: _id, name, level, ...detail } = it;
    const existing = await prisma.entranceExam.findUnique({
      where: { name_level: { name: name!, level: level! } },
    });
    const row = existing
      ? await fillBlanks(
          existing,
          detail,
          (data) => prisma.entranceExam.update({ where: { id: existing.id }, data }),
          reviewOnReuse(existing, actor)
        )
      : await prisma.entranceExam.create({
          data: { name: name!, level: level!, ...detail, ...reviewOnCreate(actor) },
        });
    resolved.set(row.id, { id: row.id, name: row.name, level: row.level });
  }
  if (ids.length) {
    const existing = await prisma.entranceExam.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, level: true } });
    if (existing.length !== new Set(ids).size) throw new BadRequestError("One or more entranceExams ids are invalid");
    for (const r of existing) resolved.set(r.id, r);
  }
  return [...resolved.values()];
}

async function resolveCourses(items: CourseLinkItem[], actor: Actor): Promise<ResolvedCourse[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedCourse>();
  for (const it of items) {
    if (it.id) continue;
    const { id: _id, name, level: rawLevel, ...detail } = it;
    const level = rawLevel ?? "UG";
    const existing = await prisma.course.findUnique({ where: { name_level: { name: name!, level } } });
    const row = existing
      ? await fillBlanks(
          existing,
          detail,
          (data) => prisma.course.update({ where: { id: existing.id }, data }),
          reviewOnReuse(existing, actor)
        )
      : await prisma.course.create({ data: { name: name!, level, ...detail, ...reviewOnCreate(actor) } });
    resolved.set(row.id, { id: row.id, name: row.name, level: row.level });
  }
  if (ids.length) {
    const existing = await prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, level: true } });
    if (existing.length !== new Set(ids).size) throw new BadRequestError("One or more courses ids are invalid");
    for (const r of existing) resolved.set(r.id, r);
  }
  return [...resolved.values()];
}

async function resolveInstitutions(items: InstitutionLinkItem[], actor: Actor): Promise<ResolvedInstitution[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedInstitution>();
  for (const it of items) {
    if (it.id) continue;
    const { id: _id, name, ...detail } = it;
    const existing = await prisma.institution.findUnique({ where: { name: name! } });
    const row = existing
      ? await fillBlanks(
          existing,
          detail,
          (data) => prisma.institution.update({ where: { id: existing.id }, data }),
          reviewOnReuse(existing, actor)
        )
      : await prisma.institution.create({ data: { name: name!, ...detail, ...reviewOnCreate(actor) } });
    resolved.set(row.id, { id: row.id, name: row.name });
  }
  if (ids.length) {
    const existing = await prisma.institution.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    if (existing.length !== new Set(ids).size) throw new BadRequestError("One or more institutions ids are invalid");
    for (const r of existing) resolved.set(r.id, r);
  }
  return [...resolved.values()];
}

// Education Path items are global canonical rows: a new `{ level, programme }` item
// find-or-creates one shared row and an `{ id }` may be any existing entry. Unlike the
// exam/course/institution lookups there is no review status to reconcile — an admin adding
// one inline publishes it ACTIVE, which is what the job-role form (admin-only) implies.
async function resolveEducationEntries(
  items: EducationLinkItem[],
  actor: Actor
): Promise<ResolvedEducationEntry[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedEducationEntry>();
  for (const it of items) {
    if (it.id) continue;
    const existing = await prisma.educationEntry.findFirst({
      where: { level: it.level!, programme: it.programme! },
    });
    const row = existing
      ? await fillBlanks(existing, { description: it.description }, (data) =>
          prisma.educationEntry.update({ where: { id: existing.id }, data })
        )
      : await prisma.educationEntry.create({
          data: {
            level: it.level!,
            programme: it.programme!,
            description: it.description,
            submittedBy: actor.userId,
            status: "ACTIVE",
          },
        });
    resolved.set(row.id, { id: row.id, level: row.level, programme: row.programme });
  }
  if (ids.length) {
    const existing = await prisma.educationEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, level: true, programme: true },
    });
    if (existing.length !== new Set(ids).size) {
      throw new BadRequestError("One or more educationEntries ids are invalid");
    }
    // No domain check: entries are global, so any of them may be attached to any role.
    for (const r of existing) {
      resolved.set(r.id, { id: r.id, level: r.level, programme: r.programme });
    }
  }
  return [...resolved.values()];
}

// An admin's submission goes straight into the real table (as before); a counsellor's is
// staged in `CareerLibraryEntryProposal` instead of ever touching career_library_entries —
// see docs/career-library-normalization-spec.md for why the tables are split.
export async function createCareerEntry(input: CreateCareerEntryInput, actor: Actor) {
  const { entranceExams = [], courses = [], institutions = [], educationEntries = [], ...scalar } = input;
  await assertLiveDomain(scalar.domainId); // 400 if domainId isn't a live taxonomy leaf
  const [exams, crs, insts, edu] = await Promise.all([
    resolveEntranceExams(entranceExams, actor),
    resolveCourses(courses, actor),
    resolveInstitutions(institutions, actor),
    resolveEducationEntries(educationEntries, actor),
  ]);

  if (!isAdmin(actor)) {
    const { status: _status, ...proposalScalar } = scalar;
    const proposal = await prisma.careerLibraryEntryProposal.create({
      data: {
        ...proposalScalar,
        examIds: exams.map((e) => e.id),
        courseIds: crs.map((c) => c.id),
        institutionIds: insts.map((i) => i.id),
        educationEntryIds: edu.map((e) => e.id),
        submittedBy: actor.userId,
      },
    });
    return getCareerEntryProposalById(proposal.id);
  }

  try {
    const created = await prisma.careerLibraryEntry.create({
      data: {
        ...scalar,
        createdBy: actor.userId,
        // Dual-write the transitional String[] columns from the resolved names.
        entranceExams: exams.filter((e) => e.level === "UG").map((e) => e.name),
        entranceExamsPG: exams.filter((e) => e.level === "PG").map((e) => e.name),
        topCourses: crs.map((c) => c.name),
        entranceExamLinks: { create: exams.map((e) => ({ entranceExamId: e.id })) },
        courseLinks: { create: crs.map((c) => ({ courseId: c.id })) },
        institutionLinks: { create: insts.map((i) => ({ institutionId: i.id })) },
        educationLinks: { create: edu.map((e) => ({ educationEntryId: e.id })) },
      },
      select: { id: true },
    });
    return getCareerLibraryEntryById(created.id);
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function updateCareerEntry(id: string, input: UpdateCareerEntryInput, actor: Actor) {
  const current = await getCareerLibraryEntryById(id); // 404 if missing
  const { entranceExams, courses, institutions, educationEntries, ...scalar } = input;
  if (scalar.domainId !== undefined) await assertLiveDomain(scalar.domainId); // 400 if invalid/deleted
  // Resolve only the link arrays that were provided (undefined = leave unchanged).
  const exams = entranceExams !== undefined ? await resolveEntranceExams(entranceExams, actor) : undefined;
  const crs = courses !== undefined ? await resolveCourses(courses, actor) : undefined;
  const insts = institutions !== undefined ? await resolveInstitutions(institutions, actor) : undefined;
  // Education entries hang off the domain, so they resolve against the domain this update
  // leaves the entry in — the new one when the update also re-parents it.
  const edu =
    educationEntries !== undefined
      ? await resolveEducationEntries(educationEntries, actor)
      : undefined;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.careerLibraryEntry.update({
        where: { id },
        data: {
          ...scalar,
          updatedBy: actor.userId,
          ...(exams
            ? {
                entranceExams: exams.filter((e) => e.level === "UG").map((e) => e.name),
                entranceExamsPG: exams.filter((e) => e.level === "PG").map((e) => e.name),
              }
            : {}),
          ...(crs ? { topCourses: crs.map((c) => c.name) } : {}),
        },
      });
      if (exams) {
        await tx.careerEntranceExam.deleteMany({ where: { careerEntryId: id } });
        await tx.careerEntranceExam.createMany({ data: exams.map((e) => ({ careerEntryId: id, entranceExamId: e.id })), skipDuplicates: true });
      }
      if (crs) {
        await tx.careerCourse.deleteMany({ where: { careerEntryId: id } });
        await tx.careerCourse.createMany({ data: crs.map((c) => ({ careerEntryId: id, courseId: c.id })), skipDuplicates: true });
      }
      if (insts) {
        await tx.careerInstitution.deleteMany({ where: { careerEntryId: id } });
        await tx.careerInstitution.createMany({ data: insts.map((i) => ({ careerEntryId: id, institutionId: i.id })), skipDuplicates: true });
      }
      if (edu) {
        await tx.careerEducationEntry.deleteMany({ where: { careerEntryId: id } });
        await tx.careerEducationEntry.createMany({ data: edu.map((e) => ({ careerEntryId: id, educationEntryId: e.id })), skipDuplicates: true });
      }
    });
  } catch (err) {
    handlePrismaError(err);
  }
  return getCareerLibraryEntryById(id);
}

// --- Dropdown / typeahead lookups ---

// Optional domain scoping: "what does this Domain already have?" — i.e. the lookup rows
// already linked to job roles whose leaf domain is `domainId`, via the join tables. Entry
// status is deliberately ignored (a draft role's exams are still the domain's data, and
// every canonical row is listable globally anyway, so this exposes nothing new).
// Omitting `domainId` keeps the global list.
function domainScope(domainId?: string) {
  return domainId ? { careerLinks: { some: { careerEntry: { domainId } } } } : {};
}

export async function listEntranceExams(query: ListEntranceExamsQuery) {
  if (query.domainId) await assertLiveDomain(query.domainId); // 400 rather than a silently empty list
  return prisma.entranceExam.findMany({
    where: {
      level: query.level,
      status: query.status,
      name: query.search ? { contains: query.search, mode: "insensitive" } : undefined,
      ...domainScope(query.domainId),
    },
    orderBy: { name: "asc" },
    take: query.limit,
    select: { id: true, name: true, level: true, fullForm: true, conductingBody: true, status: true, submittedBy: true },
  });
}

export async function listInstitutions(query: ListInstitutionsQuery) {
  if (query.domainId) await assertLiveDomain(query.domainId);
  return prisma.institution.findMany({
    where: {
      status: query.status,
      name: query.search ? { contains: query.search, mode: "insensitive" } : undefined,
      ...domainScope(query.domainId),
    },
    orderBy: { name: "asc" },
    take: query.limit,
    select: { id: true, name: true, city: true, state: true, type: true, status: true, submittedBy: true },
  });
}

export async function listCourses(query: ListCoursesQuery) {
  if (query.domainId) await assertLiveDomain(query.domainId);
  return prisma.course.findMany({
    where: {
      level: query.level,
      status: query.status,
      name: query.search ? { contains: query.search, mode: "insensitive" } : undefined,
      ...domainScope(query.domainId),
    },
    orderBy: { name: "asc" },
    take: query.limit,
    select: { id: true, name: true, level: true, fullForm: true, status: true, submittedBy: true },
  });
}

// --- Education Path entries (global canonical lookup) ---------------------------
// A global row like an exam/course/institution, attached to job roles through
// CareerEducationEntry. Domain scoping survives only as a *usage* filter on the picker,
// via domainScope() above. No review workflow and no soft delete: `status` is the same
// DRAFT/ACTIVE publish flag a CareerLibraryEntry carries, and delete is a real delete.

// Ordered by level then programme so the picker groups naturally (10+2 -> Graduate -> PG ->
// certifications), matching the enum's declaration order.
const educationOrder = [{ level: "asc" }, { programme: "asc" }] as const;

export async function listEducationEntries(query: ListEducationEntriesQuery) {
  if (query.domainId) await assertLiveDomain(query.domainId); // 400 rather than a silently empty list
  return prisma.educationEntry.findMany({
    where: {
      level: query.level,
      status: query.status,
      programme: query.search ? { contains: query.search, mode: "insensitive" } : undefined,
      ...domainScope(query.domainId),
    },
    orderBy: [...educationOrder],
    take: query.limit,
  });
}

async function getEducationEntry(entryId: string) {
  const entry = await prisma.educationEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new NotFoundError("Education path entry not found");
  return entry;
}

// `(level, programme)` is unique in the DB; this pre-check just turns the constraint
// violation into a clear 409 instead of a Prisma error.
async function assertEducationProgrammeFree(
  level: EducationPathLevel,
  programme: string,
  excludeId?: string
) {
  const clash = await prisma.educationEntry.findFirst({
    where: { level, programme, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ConflictError("This programme already exists at that level");
}

// An admin's entry is published (ACTIVE) immediately; a counsellor's lands DRAFT and stays
// out of the pickers until an admin flips it via PATCH.
export async function createEducationEntry(input: CreateEducationEntryInput, actor: Actor) {
  await assertEducationProgrammeFree(input.level, input.programme);
  const admin = actor.role === "ADMIN" || actor.role === "SUPER_ADMIN";
  return prisma.educationEntry.create({
    data: {
      level: input.level,
      programme: input.programme,
      description: input.description,
      submittedBy: actor.userId,
      status: input.status ?? (admin ? "ACTIVE" : "DRAFT"),
    },
  });
}

export async function updateEducationEntry(entryId: string, input: UpdateEducationEntryInput) {
  const existing = await getEducationEntry(entryId);
  const level = input.level ?? existing.level;
  const programme = input.programme ?? existing.programme;
  if (input.level !== undefined || input.programme !== undefined) {
    await assertEducationProgrammeFree(level, programme, entryId);
  }
  return prisma.educationEntry.update({
    where: { id: entryId },
    data: {
      level: input.level,
      programme: input.programme,
      description: input.description,
      status: input.status,
    },
  });
}

// A real delete now that there's no soft-delete column. The CareerEducationEntry rows
// cascade, so every job role that linked this programme loses it — check usage first.
export async function deleteEducationEntry(entryId: string) {
  await getEducationEntry(entryId);
  await prisma.educationEntry.delete({ where: { id: entryId } });
  return { id: entryId, deleted: true };
}

// --- Standalone reference-data submissions + review -----------------------------
// The inline "add new" inside the job-role form is admin-only (that form is), so this is
// the path a counsellor uses to propose reference data on its own. Same find-or-create
// semantics as the link items: an existing row is reused and blank-filled rather than
// duplicated, and `reviewOnReuse` decides whether that reuse publishes it.

export async function submitEntranceExam(input: SubmitEntranceExamInput, actor: Actor) {
  const { name, level, ...detail } = input;
  const existing = await prisma.entranceExam.findUnique({ where: { name_level: { name, level } } });
  if (existing) {
    return fillBlanks(
      existing,
      detail,
      (data) => prisma.entranceExam.update({ where: { id: existing.id }, data }),
      reviewOnReuse(existing, actor)
    );
  }
  return prisma.entranceExam.create({ data: { name, level, ...detail, ...reviewOnCreate(actor) } });
}

export async function submitCourse(input: SubmitCourseInput, actor: Actor) {
  const { name, level, ...detail } = input;
  const existing = await prisma.course.findUnique({ where: { name_level: { name, level } } });
  if (existing) {
    return fillBlanks(
      existing,
      detail,
      (data) => prisma.course.update({ where: { id: existing.id }, data }),
      reviewOnReuse(existing, actor)
    );
  }
  return prisma.course.create({ data: { name, level, ...detail, ...reviewOnCreate(actor) } });
}

export async function submitInstitution(input: SubmitInstitutionInput, actor: Actor) {
  const { name, ...detail } = input;
  const existing = await prisma.institution.findUnique({ where: { name } });
  if (existing) {
    return fillBlanks(
      existing,
      detail,
      (data) => prisma.institution.update({ where: { id: existing.id }, data }),
      reviewOnReuse(existing, actor)
    );
  }
  return prisma.institution.create({ data: { name, ...detail, ...reviewOnCreate(actor) } });
}

// Review is in place: the row IS the submission, so approving flips DRAFT -> ACTIVE rather
// than creating anything. Rejecting hard-deletes it (no REJECTED-but-kept state, unlike the
// old 3-state ReviewStatus) — refused when the row is already linked to a job role, since
// the join tables cascade-delete and would silently strip it from every role that used it.
// Every reviewable table carries the same status column plus one join table, so one helper
// pair serves all of them — but Prisma's per-model delegates don't unify, so each entity
// supplies its own find/update/countLinks/remove closures rather than being reached through
// an index.
interface Reviewable {
  label: string;
  find: (id: string) => Promise<{ id: string; status: CareerLibraryStatus } | null>;
  publish: (id: string) => Promise<unknown>;
  countLinks: (id: string) => Promise<number>;
  remove: (id: string) => Promise<unknown>;
}

const reviewables = {
  entranceExam: {
    label: "Entrance exam",
    find: (id) => prisma.entranceExam.findUnique({ where: { id }, select: { id: true, status: true } }),
    publish: (id) => prisma.entranceExam.update({ where: { id }, data: { status: "ACTIVE" } }),
    countLinks: (id) => prisma.careerEntranceExam.count({ where: { entranceExamId: id } }),
    remove: (id) => prisma.entranceExam.delete({ where: { id } }),
  },
  course: {
    label: "Course",
    find: (id) => prisma.course.findUnique({ where: { id }, select: { id: true, status: true } }),
    publish: (id) => prisma.course.update({ where: { id }, data: { status: "ACTIVE" } }),
    countLinks: (id) => prisma.careerCourse.count({ where: { courseId: id } }),
    remove: (id) => prisma.course.delete({ where: { id } }),
  },
  institution: {
    label: "Institution",
    find: (id) => prisma.institution.findUnique({ where: { id }, select: { id: true, status: true } }),
    publish: (id) => prisma.institution.update({ where: { id }, data: { status: "ACTIVE" } }),
    countLinks: (id) => prisma.careerInstitution.count({ where: { institutionId: id } }),
    remove: (id) => prisma.institution.delete({ where: { id } }),
  },
} satisfies Record<string, Reviewable>;

async function approveLookup(kind: keyof typeof reviewables, id: string) {
  const { label, find, publish } = reviewables[kind];
  const existing = await find(id);
  if (!existing) throw new NotFoundError(`${label} not found`);
  if (existing.status === "ACTIVE") throw new ConflictError(`${label} is already active`);
  return publish(id);
}

async function rejectLookup(kind: keyof typeof reviewables, id: string) {
  const { label, find, countLinks, remove } = reviewables[kind];
  const existing = await find(id);
  if (!existing) throw new NotFoundError(`${label} not found`);
  if (existing.status === "ACTIVE") {
    throw new ConflictError(`${label} is already active — unpublish it before rejecting`);
  }
  const linked = await countLinks(id);
  if (linked > 0) {
    throw new ConflictError(`${label} is linked to ${linked} job role(s) — unlink them before rejecting`);
  }
  await remove(id);
  return { id, deleted: true };
}

export const approveEntranceExam = (id: string) => approveLookup("entranceExam", id);
export const rejectEntranceExam = (id: string) => rejectLookup("entranceExam", id);
export const approveCourse = (id: string) => approveLookup("course", id);
export const rejectCourse = (id: string) => rejectLookup("course", id);
export const approveInstitution = (id: string) => approveLookup("institution", id);
export const rejectInstitution = (id: string) => rejectLookup("institution", id);

// A direct edit of the canonical row (see updateEntranceExamSchema): unlike the "select
// existing or add new" resolvers above, this always writes every provided field straight
// through — correcting a wrong value is deliberate, not a side effect of linking it.
export async function updateEntranceExam(id: string, input: UpdateEntranceExamInput) {
  const existing = await prisma.entranceExam.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Entrance exam not found");
  try {
    return await prisma.entranceExam.update({ where: { id }, data: input });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function updateCourse(id: string, input: UpdateCourseInput) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Course not found");
  try {
    return await prisma.course.update({ where: { id }, data: input });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function updateInstitution(id: string, input: UpdateInstitutionInput) {
  const existing = await prisma.institution.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Institution not found");
  try {
    return await prisma.institution.update({ where: { id }, data: input });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function deleteCareerEntry(id: string) {
  const entry = await prisma.careerLibraryEntry.findUnique({ where: { id } });
  if (!entry) {
    throw new NotFoundError("Career library entry not found");
  }
  await prisma.careerLibraryEntry.delete({ where: { id } });
}

// --- Job role proposals (counsellor submits, admin decides) --------------------
// A counsellor's job role is staged entirely in `CareerLibraryEntryProposal`, never touching
// career_library_entries. Approving copies it into a fresh CareerLibraryEntry (new id,
// status ACTIVE) and materializes the join-table rows from the proposal's resolved id
// arrays; rejecting just deletes the proposal. Nothing about an unapproved role is worth
// keeping, and it keeps the real table free of tombstones or PENDING rows to filter out.

async function hydrateProposal<
  T extends {
    domainId: string;
    examIds: string[];
    courseIds: string[];
    institutionIds: string[];
    educationEntryIds: string[];
  },
>(proposal: T) {
  const [domain, linkedEntranceExams, linkedCourses, linkedInstitutions, linkedEducationEntries] = await Promise.all([
    prisma.careerDomain.findUnique({ where: { id: proposal.domainId }, select: domainChainSelect }),
    proposal.examIds.length
      ? prisma.entranceExam.findMany({ where: { id: { in: proposal.examIds } }, select: entranceExamDetailSelect })
      : Promise.resolve([]),
    proposal.courseIds.length
      ? prisma.course.findMany({ where: { id: { in: proposal.courseIds } }, select: courseDetailSelect })
      : Promise.resolve([]),
    proposal.institutionIds.length
      ? prisma.institution.findMany({ where: { id: { in: proposal.institutionIds } }, select: institutionDetailSelect })
      : Promise.resolve([]),
    proposal.educationEntryIds.length
      ? prisma.educationEntry.findMany({
          where: { id: { in: proposal.educationEntryIds } },
          select: { id: true, level: true, programme: true, description: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  return { ...proposal, domain, linkedEntranceExams, linkedCourses, linkedInstitutions, linkedEducationEntries };
}

export async function listCareerEntryProposals(query: ListCareerEntryProposalsQuery) {
  const where: Prisma.CareerLibraryEntryProposalWhereInput = {
    ...(query.domainId ? { domainId: query.domainId } : {}),
    ...(query.search ? { jobRole: { contains: query.search, mode: "insensitive" } } : {}),
  };
  const [total, proposals] = await Promise.all([
    prisma.careerLibraryEntryProposal.count({ where }),
    prisma.careerLibraryEntryProposal.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    data: await Promise.all(proposals.map(hydrateProposal)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

async function findCareerEntryProposal(id: string) {
  const proposal = await prisma.careerLibraryEntryProposal.findUnique({ where: { id } });
  if (!proposal) throw new NotFoundError("Career library entry proposal not found");
  return proposal;
}

export async function getCareerEntryProposalById(id: string) {
  return hydrateProposal(await findCareerEntryProposal(id));
}

export async function approveCareerEntryProposal(id: string, actor: Actor) {
  const proposal = await findCareerEntryProposal(id);
  const { id: _id, examIds, courseIds, institutionIds, educationEntryIds, submittedBy, createdAt, updatedAt, domainId, ...scalar } =
    proposal;
  await assertLiveDomain(domainId); // taxonomy may have moved on since the submission

  const [exams, courses] = await Promise.all([
    examIds.length
      ? prisma.entranceExam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true, level: true } })
      : Promise.resolve([]),
    courseIds.length
      ? prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.careerLibraryEntry.create({
        data: {
          ...scalar,
          domainId,
          status: "ACTIVE",
          createdBy: submittedBy,
          entranceExams: exams.filter((e) => e.level === "UG").map((e) => e.name),
          entranceExamsPG: exams.filter((e) => e.level === "PG").map((e) => e.name),
          topCourses: courses.map((c) => c.name),
          entranceExamLinks: { create: examIds.map((entranceExamId) => ({ entranceExamId })) },
          courseLinks: { create: courseIds.map((courseId) => ({ courseId })) },
          institutionLinks: { create: institutionIds.map((institutionId) => ({ institutionId })) },
          educationLinks: { create: educationEntryIds.map((educationEntryId) => ({ educationEntryId })) },
        },
        select: { id: true },
      });
      await tx.careerLibraryEntryProposal.delete({ where: { id } });
      return entry;
    });
    return getCareerLibraryEntryById(created.id);
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function rejectCareerEntryProposal(id: string) {
  await findCareerEntryProposal(id);
  await prisma.careerLibraryEntryProposal.delete({ where: { id } });
  return { id, deleted: true };
}

// --- Education Path review -----------------------------------------------------
// Education entries carry DRAFT/ACTIVE (see `EducationEntry`), so "pending" here means
// DRAFT: a counsellor's create lands there, an admin's goes straight to ACTIVE. Approving
// publishes it into the pickers.

export async function approveEducationEntry(entryId: string) {
  const existing = await getEducationEntry(entryId);
  if (existing.status === "ACTIVE") {
    throw new ConflictError("Education path entry is already active");
  }
  return prisma.educationEntry.update({ where: { id: entryId }, data: { status: "ACTIVE" } });
}

// Reject deletes, matching the job-role flow. Refused when the programme is already linked
// to job roles: `CareerEducationEntry` cascades, so deleting would silently strip the
// programme from every one of them. Unpublish it with PATCH ?status=DRAFT instead.
export async function rejectEducationEntry(entryId: string) {
  const existing = await getEducationEntry(entryId);
  if (existing.status === "ACTIVE") {
    throw new ConflictError("Education path entry is already active — unpublish it before rejecting");
  }
  const linked = await prisma.careerEducationEntry.count({ where: { educationEntryId: entryId } });
  if (linked > 0) {
    throw new ConflictError(
      `Education path entry is linked to ${linked} job role(s) — unlink them before rejecting`
    );
  }
  await prisma.educationEntry.delete({ where: { id: entryId } });
  return { id: entryId, deleted: true };
}

