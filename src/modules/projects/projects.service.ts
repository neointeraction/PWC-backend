import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from "./projects.schema.js";

const projectInclude = {
  institute: { select: { id: true, name: true } },
  _count: { select: { students: true, counsellors: true, counsellorSlots: true } },
} as const;

export async function createProject(input: CreateProjectInput) {
  const institute = await prisma.institute.findUnique({ where: { id: input.instituteId } });
  if (!institute) {
    throw new BadRequestError("instituteId does not exist");
  }

  try {
    return await prisma.project.create({
      data: {
        instituteId: input.instituteId,
        name: input.name,
        fromDate: input.fromDate,
        toDate: input.toDate,
        status: input.status,
      },
      include: projectInclude,
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

  try {
    return await prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        fromDate: input.fromDate,
        toDate: input.toDate,
        status: input.status,
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
