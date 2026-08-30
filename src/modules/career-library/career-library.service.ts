import { Prisma } from "@prisma/client";
import type { EducationPathLevel, ReviewStatus, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { assertLiveDomain } from "../career-taxonomy/career-taxonomy.service.js";
import type {
  ApproveCareerRequestInput,
  CourseLinkItem,
  CreateCareerEntryInput,
  CreateCareerRequestInput,
  EducationLinkItem,
  ExamLinkItem,
  InstitutionLinkItem,
  ListCareerLibraryQuery,
  ListCareerRequestsQuery,
  ListCoursesQuery,
  ListEntranceExamsQuery,
  ListInstitutionsQuery,
  SubmitCourseInput,
  SubmitEntranceExamInput,
  SubmitInstitutionInput,
  UpdateCareerEntryInput,
} from "./career-library.schema.js";

// The authenticated actor performing a write (from the access token).
export interface Actor {
  userId: string;
  role: UserRole;
}

const isAdmin = (actor: Actor): boolean => actor.role === "ADMIN" || actor.role === "SUPER_ADMIN";

// Review state for a reference row this actor is creating. An admin's addition is live
// immediately (and counts as its own approval); a counsellor's waits for review.
function reviewOnCreate(actor: Actor) {
  return isAdmin(actor)
    ? { status: "APPROVED" as const, submittedBy: actor.userId, reviewedBy: actor.userId, reviewedAt: new Date() }
    : { status: "PENDING" as const, submittedBy: actor.userId };
}

// What to do when a find-or-create lands on a row that already exists:
//   - an ADMIN naming a row a counsellor proposed is an implicit approval;
//   - anyone re-proposing a REJECTED row reopens it for review;
//   - otherwise leave the review state alone.
// Returned as an update patch, merged with the blank-fill patch by the callers below.
function reviewOnReuse(existing: { status: ReviewStatus }, actor: Actor) {
  if (existing.status === "PENDING" && isAdmin(actor)) {
    return { status: "APPROVED" as const, reviewedBy: actor.userId, reviewedAt: new Date() };
  }
  if (existing.status === "REJECTED") {
    return isAdmin(actor)
      ? { status: "APPROVED" as const, reviewedBy: actor.userId, reviewedAt: new Date(), rejectionReason: null }
      : { status: "PENDING" as const, submittedBy: actor.userId, reviewedBy: null, reviewedAt: null, rejectionReason: null };
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
const entryLinkInclude = {
  ...domainChainInclude,
  entranceExamLinks: {
    select: { entranceExam: { select: { id: true, name: true, level: true, fullForm: true, status: true } } },
    orderBy: { entranceExam: { name: "asc" } },
  },
  courseLinks: {
    select: { course: { select: { id: true, name: true, level: true, status: true } } },
    orderBy: { course: { name: "asc" } },
  },
  institutionLinks: {
    select: { institution: { select: { id: true, name: true, city: true, state: true, status: true } } },
    orderBy: { institution: { name: "asc" } },
  },
  educationLinks: {
    select: {
      educationEntry: { select: { id: true, level: true, programme: true, description: true, deletedAt: true, status: true } },
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

// Education Path items are scoped to the entry's own domain: a new `{ level, programme }`
// is written back to that domain (so every future role there inherits it), and an existing
// `{ id }` must already belong to it — linking another domain's path would silently break
// the "shown as a tick-list of what THIS domain has" contract.
async function resolveEducationEntries(
  items: EducationLinkItem[],
  domainId: string,
  actor: Actor
): Promise<ResolvedEducationEntry[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedEducationEntry>();
  for (const it of items) {
    if (it.id) continue;
    const existing = await prisma.domainEducationEntry.findFirst({
      where: { domainId, level: it.level!, programme: it.programme!, deletedAt: null },
    });
    const row = existing
      ? await fillBlanks(
          existing,
          { description: it.description },
          (data) => prisma.domainEducationEntry.update({ where: { id: existing.id }, data }),
          reviewOnReuse(existing, actor)
        )
      : await prisma.domainEducationEntry.create({
          data: {
            domainId,
            level: it.level!,
            programme: it.programme!,
            description: it.description,
            ...reviewOnCreate(actor),
          },
        });
    resolved.set(row.id, { id: row.id, level: row.level, programme: row.programme });
  }
  if (ids.length) {
    const existing = await prisma.domainEducationEntry.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, level: true, programme: true, domainId: true },
    });
    if (existing.length !== new Set(ids).size) {
      throw new BadRequestError("One or more educationEntries ids are invalid or deleted");
    }
    for (const r of existing) {
      if (r.domainId !== domainId) {
        throw new BadRequestError("An educationEntries id belongs to a different career domain");
      }
      resolved.set(r.id, { id: r.id, level: r.level, programme: r.programme });
    }
  }
  return [...resolved.values()];
}

export async function createCareerEntry(input: CreateCareerEntryInput, actor: Actor) {
  const { entranceExams = [], courses = [], institutions = [], educationEntries = [], ...scalar } = input;
  await assertLiveDomain(scalar.domainId); // 400 if domainId isn't a live taxonomy leaf
  const [exams, crs, insts, edu] = await Promise.all([
    resolveEntranceExams(entranceExams, actor),
    resolveCourses(courses, actor),
    resolveInstitutions(institutions, actor),
    resolveEducationEntries(educationEntries, scalar.domainId, actor),
  ]);
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
      ? await resolveEducationEntries(educationEntries, scalar.domainId ?? current.domainId, actor)
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

// --- Standalone reference-data submissions + review -----------------------------
// The inline "add new" inside the job-role form is admin-only (that form is), so this is
// the path a counsellor uses to propose reference data on its own. Same find-or-create
// semantics as the link items: an existing row is reused and blank-filled rather than
// duplicated, and `reviewOnReuse` decides whether that reuse approves or reopens it.

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

// Review is in place: the row IS the submission, so approving flips its status rather than
// creating anything. Re-reviewing a row that was already decided is a 409 — the admin is
// looking at a stale queue.
// Every reviewable table carries the same five review columns, so one helper serves all
// of them — but Prisma's per-model delegates don't unify, so each entity supplies its own
// find/update closures rather than being reached through an index.
type ReviewPatch = {
  status: ReviewStatus;
  reviewedBy: string;
  reviewedAt: Date;
  rejectionReason: string | null;
};

interface Reviewable {
  label: string;
  find: (id: string) => Promise<{ id: string; status: ReviewStatus } | null>;
  update: (id: string, data: ReviewPatch) => Promise<unknown>;
}

const reviewables = {
  entranceExam: {
    label: "Entrance exam",
    find: (id) => prisma.entranceExam.findUnique({ where: { id } }),
    update: (id, data) => prisma.entranceExam.update({ where: { id }, data }),
  },
  course: {
    label: "Course",
    find: (id) => prisma.course.findUnique({ where: { id } }),
    update: (id, data) => prisma.course.update({ where: { id }, data }),
  },
  institution: {
    label: "Institution",
    find: (id) => prisma.institution.findUnique({ where: { id } }),
    update: (id, data) => prisma.institution.update({ where: { id }, data }),
  },
} satisfies Record<string, Reviewable>;

async function reviewLookup(
  kind: keyof typeof reviewables,
  id: string,
  decision: "APPROVED" | "REJECTED",
  actor: Actor,
  rejectionReason?: string
) {
  const { label, find, update } = reviewables[kind];
  const existing = await find(id);
  if (!existing) throw new NotFoundError(`${label} not found`);
  if (existing.status !== "PENDING") {
    throw new ConflictError(`${label} has already been ${existing.status.toLowerCase()}`);
  }
  return update(id, {
    status: decision,
    reviewedBy: actor.userId,
    reviewedAt: new Date(),
    rejectionReason: decision === "REJECTED" ? rejectionReason ?? null : null,
  });
}

export const approveEntranceExam = (id: string, actor: Actor) => reviewLookup("entranceExam", id, "APPROVED", actor);
export const rejectEntranceExam = (id: string, actor: Actor, reason?: string) =>
  reviewLookup("entranceExam", id, "REJECTED", actor, reason);
export const approveCourse = (id: string, actor: Actor) => reviewLookup("course", id, "APPROVED", actor);
export const rejectCourse = (id: string, actor: Actor, reason?: string) =>
  reviewLookup("course", id, "REJECTED", actor, reason);
export const approveInstitution = (id: string, actor: Actor) => reviewLookup("institution", id, "APPROVED", actor);
export const rejectInstitution = (id: string, actor: Actor, reason?: string) =>
  reviewLookup("institution", id, "REJECTED", actor, reason);

export async function deleteCareerEntry(id: string) {
  const entry = await prisma.careerLibraryEntry.findUnique({ where: { id } });
  if (!entry) {
    throw new NotFoundError("Career library entry not found");
  }
  // A ratification request may point at this entry (resultingEntryId, ON DELETE RESTRICT).
  // Detach those links first so the delete can proceed without orphaning the request.
  await prisma.$transaction([
    prisma.careerLibraryRequest.updateMany({
      where: { resultingEntryId: id },
      data: { resultingEntryId: null },
    }),
    prisma.careerLibraryEntry.delete({ where: { id } }),
  ]);
}

// --- Ratification requests -----------------------------------------------------

// Resolves the Counsellor id that owns a new request. Counsellors file as themselves
// (resolved from their token); an admin/super admin may file on behalf of a counsellor by
// passing `requestedById` explicitly.
async function resolveRequesterCounsellorId(actor: Actor, requestedById?: string): Promise<string> {
  if (actor.role === "COUNSELLOR") {
    const counsellor = await prisma.counsellor.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!counsellor) {
      throw new BadRequestError("No counsellor profile is linked to this account");
    }
    return counsellor.id;
  }
  // Admin/super admin acting on behalf of a counsellor.
  if (!requestedById) {
    throw new BadRequestError("requestedById is required when an admin submits a request");
  }
  const counsellor = await prisma.counsellor.findUnique({ where: { id: requestedById }, select: { id: true } });
  if (!counsellor) {
    throw new BadRequestError("requestedById does not match a counsellor");
  }
  return counsellor.id;
}

export async function createCareerRequest(input: CreateCareerRequestInput, actor: Actor) {
  const requestedById = await resolveRequesterCounsellorId(actor, input.requestedById);
  return prisma.careerLibraryRequest.create({
    data: {
      requestedById,
      jobTitle: input.jobTitle,
      suggestedCluster: input.suggestedCluster,
      suggestedIndustry: input.suggestedIndustry,
      suggestedDomain: input.suggestedDomain,
      oneLineDescription: input.oneLineDescription,
      justification: input.justification,
      referenceLinks: input.referenceLinks,
    },
  });
}

export async function listCareerRequests(query: ListCareerRequestsQuery) {
  return prisma.careerLibraryRequest.findMany({
    where: { status: query.status, requestedById: query.requestedById },
    include: { resultingEntry: { select: { id: true, jobRole: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCareerRequestById(requestId: string) {
  const request = await prisma.careerLibraryRequest.findUnique({
    where: { id: requestId },
    include: { resultingEntry: { select: { id: true, jobRole: true, status: true } } },
  });
  if (!request) {
    throw new NotFoundError("Career library request not found");
  }
  return request;
}

async function reviewRequest(
  requestId: string,
  status: "APPROVED" | "REJECTED",
  actor: Actor,
  resultingEntryId?: string
) {
  const request = await prisma.careerLibraryRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    throw new NotFoundError("Career library request not found");
  }
  if (request.status !== "PENDING") {
    throw new ConflictError(`Request has already been ${request.status.toLowerCase()}`);
  }
  if (resultingEntryId) {
    const entry = await prisma.careerLibraryEntry.findUnique({ where: { id: resultingEntryId } });
    if (!entry) {
      throw new BadRequestError("resultingEntryId does not match a career library entry");
    }
  }
  return prisma.careerLibraryRequest.update({
    where: { id: requestId },
    data: {
      status,
      reviewedBy: actor.userId,
      reviewedAt: new Date(),
      resultingEntryId: status === "APPROVED" ? resultingEntryId ?? null : null,
    },
    include: { resultingEntry: { select: { id: true, jobRole: true, status: true } } },
  });
}

export async function approveCareerRequest(requestId: string, input: ApproveCareerRequestInput, actor: Actor) {
  return reviewRequest(requestId, "APPROVED", actor, input.resultingEntryId);
}

export async function rejectCareerRequest(requestId: string, actor: Actor) {
  return reviewRequest(requestId, "REJECTED", actor);
}
