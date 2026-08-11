import { Prisma } from "@prisma/client";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import type {
  ApproveCareerRequestInput,
  CreateCareerEntryInput,
  CreateCareerRequestInput,
  ListCareerLibraryQuery,
  ListCareerRequestsQuery,
  UpdateCareerEntryInput,
} from "./career-library.schema.js";

// The authenticated actor performing a write (from the access token).
export interface Actor {
  userId: string;
  role: UserRole;
}

export async function listCareerLibraryEntries(query: ListCareerLibraryQuery) {
  const where: Prisma.CareerLibraryEntryWhereInput = {
    status: query.status,
    cluster: query.cluster,
    industry: query.industry,
    domain: query.domain,
    aiResilienceGrade: query.aiResilienceGrade,
    ...(query.search
      ? {
          OR: [
            { jobRole: { contains: query.search, mode: "insensitive" } },
            { cluster: { contains: query.search, mode: "insensitive" } },
            { industry: { contains: query.search, mode: "insensitive" } },
            { domain: { contains: query.search, mode: "insensitive" } },
            { oneLineDescription: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.careerLibraryEntry.count({ where }),
    prisma.careerLibraryEntry.findMany({
      where,
      orderBy: [{ cluster: "asc" }, { jobRole: "asc" }],
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

// Distinct values for building filter dropdowns (Cluster / Industry / Domain / AI Grade).
export async function getCareerLibraryFilters() {
  const [clusters, industries, domains] = await Promise.all([
    prisma.careerLibraryEntry.findMany({
      where: { status: "ACTIVE" },
      distinct: ["cluster"],
      select: { cluster: true },
      orderBy: { cluster: "asc" },
    }),
    prisma.careerLibraryEntry.findMany({
      where: { status: "ACTIVE" },
      distinct: ["industry"],
      select: { industry: true },
      orderBy: { industry: "asc" },
    }),
    prisma.careerLibraryEntry.findMany({
      where: { status: "ACTIVE" },
      distinct: ["domain"],
      select: { domain: true },
      orderBy: { domain: "asc" },
    }),
  ]);

  return {
    clusters: clusters.map((c) => c.cluster),
    industries: industries.map((i) => i.industry),
    domains: domains.map((d) => d.domain),
    aiResilienceGrades: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"],
  };
}

// Detail view surfaces the cross-table mapping (see docs/db-design.md "Career Library
// workbook import"): related UG institutions by industry, UG courses by cluster, and
// UG entrance exams by the extracted exam-name list. Plain value matches, not FKs.
export async function getCareerLibraryEntryById(id: string) {
  const entry = await prisma.careerLibraryEntry.findUnique({ where: { id } });
  if (!entry) {
    throw new NotFoundError("Career library entry not found");
  }

  const [relatedInstitutions, relatedCourses, relatedEntranceExams] = await Promise.all([
    prisma.ugInstitution.findMany({
      where: { industry: entry.industry },
      orderBy: { name: "asc" },
    }),
    prisma.ugCourse.findMany({
      where: { careerCluster: entry.cluster },
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
    ...entry,
    relatedInstitutions,
    relatedCourses,
    relatedEntranceExams,
  };
}

// --- Entry writes (admin/super admin) ------------------------------------------

export async function createCareerEntry(input: CreateCareerEntryInput, actor: Actor) {
  try {
    return await prisma.careerLibraryEntry.create({
      data: { ...input, createdBy: actor.userId },
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function updateCareerEntry(id: string, input: UpdateCareerEntryInput, actor: Actor) {
  await getCareerLibraryEntryById(id); // 404 if missing
  try {
    return await prisma.careerLibraryEntry.update({
      where: { id },
      data: { ...input, updatedBy: actor.userId },
    });
  } catch (err) {
    handlePrismaError(err);
  }
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
