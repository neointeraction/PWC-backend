import { Prisma } from "@prisma/client";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { assertLiveDomain } from "../career-taxonomy/career-taxonomy.service.js";
import type {
  ApproveCareerRequestInput,
  CourseLinkItem,
  CreateCareerEntryInput,
  CreateCareerRequestInput,
  ExamLinkItem,
  InstitutionLinkItem,
  ListCareerLibraryQuery,
  ListCareerRequestsQuery,
  ListCoursesQuery,
  ListEntranceExamsQuery,
  ListInstitutionsQuery,
  UpdateCareerEntryInput,
} from "./career-library.schema.js";

// The authenticated actor performing a write (from the access token).
export interface Actor {
  userId: string;
  role: UserRole;
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
    select: { entranceExam: { select: { id: true, name: true, level: true, fullForm: true } } },
    orderBy: { entranceExam: { name: "asc" } },
  },
  courseLinks: {
    select: { course: { select: { id: true, name: true, level: true } } },
    orderBy: { course: { name: "asc" } },
  },
  institutionLinks: {
    select: { institution: { select: { id: true, name: true, city: true, state: true } } },
    orderBy: { institution: { name: "asc" } },
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
  const { entranceExamLinks, courseLinks, institutionLinks, ...rest } = entry;

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

async function resolveEntranceExams(items: ExamLinkItem[]): Promise<ResolvedExam[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedExam>();
  for (const it of items) {
    if (it.id) continue;
    const row = await prisma.entranceExam.upsert({
      where: { name_level: { name: it.name!, level: it.level! } },
      update: {},
      create: { name: it.name!, level: it.level! },
      select: { id: true, name: true, level: true },
    });
    resolved.set(row.id, row);
  }
  if (ids.length) {
    const existing = await prisma.entranceExam.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, level: true } });
    if (existing.length !== new Set(ids).size) throw new BadRequestError("One or more entranceExams ids are invalid");
    for (const r of existing) resolved.set(r.id, r);
  }
  return [...resolved.values()];
}

async function resolveCourses(items: CourseLinkItem[]): Promise<ResolvedCourse[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedCourse>();
  for (const it of items) {
    if (it.id) continue;
    const level = it.level ?? "UG";
    const row = await prisma.course.upsert({
      where: { name_level: { name: it.name!, level } },
      update: {},
      create: { name: it.name!, level },
      select: { id: true, name: true, level: true },
    });
    resolved.set(row.id, row);
  }
  if (ids.length) {
    const existing = await prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, level: true } });
    if (existing.length !== new Set(ids).size) throw new BadRequestError("One or more courses ids are invalid");
    for (const r of existing) resolved.set(r.id, r);
  }
  return [...resolved.values()];
}

async function resolveInstitutions(items: InstitutionLinkItem[]): Promise<ResolvedInstitution[]> {
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const resolved = new Map<string, ResolvedInstitution>();
  for (const it of items) {
    if (it.id) continue;
    const row = await prisma.institution.upsert({
      where: { name: it.name! },
      update: {},
      create: { name: it.name!, city: it.city, state: it.state },
      select: { id: true, name: true },
    });
    resolved.set(row.id, row);
  }
  if (ids.length) {
    const existing = await prisma.institution.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    if (existing.length !== new Set(ids).size) throw new BadRequestError("One or more institutions ids are invalid");
    for (const r of existing) resolved.set(r.id, r);
  }
  return [...resolved.values()];
}

export async function createCareerEntry(input: CreateCareerEntryInput, actor: Actor) {
  const { entranceExams = [], courses = [], institutions = [], ...scalar } = input;
  await assertLiveDomain(scalar.domainId); // 400 if domainId isn't a live taxonomy leaf
  const [exams, crs, insts] = await Promise.all([
    resolveEntranceExams(entranceExams),
    resolveCourses(courses),
    resolveInstitutions(institutions),
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
      },
      select: { id: true },
    });
    return getCareerLibraryEntryById(created.id);
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function updateCareerEntry(id: string, input: UpdateCareerEntryInput, actor: Actor) {
  await getCareerLibraryEntryById(id); // 404 if missing
  const { entranceExams, courses, institutions, ...scalar } = input;
  if (scalar.domainId !== undefined) await assertLiveDomain(scalar.domainId); // 400 if invalid/deleted
  // Resolve only the link arrays that were provided (undefined = leave unchanged).
  const exams = entranceExams !== undefined ? await resolveEntranceExams(entranceExams) : undefined;
  const crs = courses !== undefined ? await resolveCourses(courses) : undefined;
  const insts = institutions !== undefined ? await resolveInstitutions(institutions) : undefined;
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
    });
  } catch (err) {
    handlePrismaError(err);
  }
  return getCareerLibraryEntryById(id);
}

// --- Dropdown / typeahead lookups ---

export async function listEntranceExams(query: ListEntranceExamsQuery) {
  return prisma.entranceExam.findMany({
    where: { level: query.level, name: query.search ? { contains: query.search, mode: "insensitive" } : undefined },
    orderBy: { name: "asc" },
    take: query.limit,
    select: { id: true, name: true, level: true, fullForm: true, conductingBody: true },
  });
}

export async function listInstitutions(query: ListInstitutionsQuery) {
  return prisma.institution.findMany({
    where: { name: query.search ? { contains: query.search, mode: "insensitive" } : undefined },
    orderBy: { name: "asc" },
    take: query.limit,
    select: { id: true, name: true, city: true, state: true, type: true },
  });
}

export async function listCourses(query: ListCoursesQuery) {
  return prisma.course.findMany({
    where: { level: query.level, name: query.search ? { contains: query.search, mode: "insensitive" } : undefined },
    orderBy: { name: "asc" },
    take: query.limit,
    select: { id: true, name: true, level: true, fullForm: true },
  });
}

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
