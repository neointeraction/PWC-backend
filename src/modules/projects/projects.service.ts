import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { nextCode } from "../../common/utils/codeSequence.js";
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from "./projects.schema.js";

const projectInclude = {
  institute: { select: { id: true, name: true, address: true } },
  language: { select: { id: true, code: true, name: true } },
  _count: { select: { students: true, counsellors: true, counsellorSlots: true } },
} as const;

// Resolves the language for a project. An explicit (active) languageId wins; otherwise we
// fall back to the seeded default (English today). Throws if the id is unknown/inactive, or
// if no default is configured (misconfigured seed).
async function resolveLanguageId(languageId?: string): Promise<string> {
  if (languageId) {
    const language = await prisma.language.findFirst({ where: { id: languageId, isActive: true } });
    if (!language) {
      throw new BadRequestError("languageId does not exist or is inactive");
    }
    return language.id;
  }
  const fallback = await prisma.language.findFirst({ where: { isDefault: true, isActive: true } });
  if (!fallback) {
    throw new BadRequestError("No default language is configured");
  }
  return fallback.id;
}

export async function createProject(input: CreateProjectInput) {
  const institute = await prisma.institute.findUnique({ where: { id: input.instituteId } });
  if (!institute) {
    throw new BadRequestError("instituteId does not exist");
  }
  const languageId = await resolveLanguageId(input.languageId);

  try {
    // Code generation and create share a transaction so a failed create (e.g. duplicate
    // name) rolls back the counter increment, leaving the P-sequence gap-free.
    return await prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, "PROJECT");
      return tx.project.create({
        data: {
          code,
          instituteId: input.instituteId,
          name: input.name,
          fromDate: input.fromDate,
          toDate: input.toDate,
          status: input.status,
          languageId,
        },
        include: projectInclude,
      });
    });
  } catch (err) {
    handlePrismaError(err); // P2002 on [instituteId, name] → 409
  }
}

export async function listProjects(query: ListProjectsQuery) {
  return prisma.project.findMany({
    where: {
      instituteId: query.instituteId,
      // No status filter → exclude soft-deleted (active + closed). An explicit status
      // (incl. DELETED) filters to exactly that.
      status: query.status ?? { not: "DELETED" },
    },
    include: projectInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getProjectById(id: string) {
  const project = await prisma.project.findUnique({ where: { id }, include: projectInclude });
  if (!project) {
    throw new NotFoundError("Project not found");
  }
  return project;
}

export async function updateProject(id: string, input: UpdateProjectInput) {
  const existing = await getProjectById(id);

  // Validate the effective date window after merging the (possibly partial) update.
  const fromDate = input.fromDate ?? existing.fromDate;
  const toDate = input.toDate ?? existing.toDate;
  if (fromDate > toDate) {
    throw new BadRequestError("fromDate must be on or before toDate");
  }

  // Only re-resolve when a languageId was supplied (undefined leaves it unchanged).
  const languageId = input.languageId !== undefined ? await resolveLanguageId(input.languageId) : undefined;

  try {
    return await prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        fromDate: input.fromDate,
        toDate: input.toDate,
        status: input.status,
        languageId,
      },
      include: projectInclude,
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

// Soft-delete: flag the project DELETED (reversible). Data is preserved — students,
// forms, assessments, sessions all stay intact — the project is just hidden from the
// default listing and its student/parent submissions are blocked (see projectWindow).
export async function deleteProject(id: string) {
  await getProjectById(id); // 404 if missing
  return prisma.project.update({
    where: { id },
    data: { status: "DELETED" },
    include: projectInclude,
  });
}

// Restore: always back to ACTIVE (prior status isn't tracked — matches the UI contract).
export async function restoreProject(id: string) {
  await getProjectById(id); // 404 if missing
  return prisma.project.update({
    where: { id },
    data: { status: "ACTIVE" },
    include: projectInclude,
  });
}
