import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
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
    where: { instituteId: query.instituteId, status: query.status },
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

export async function deleteProject(id: string) {
  const existing = await getProjectById(id);

  // A project scopes all of a cohort's students (and their forms/assessments/sessions).
  // Hard-deleting one with students would cascade-wipe all of that — refuse and point the
  // admin at closing it instead (PATCH status:CLOSED, the intended purge boundary).
  if (existing._count.students > 0) {
    throw new ConflictError(
      "Project has students and cannot be deleted; close it instead (PATCH status:CLOSED)",
      { studentCount: existing._count.students }
    );
  }

  // No students — safe to remove. Cascades any counsellor slots and project-counsellor
  // assignment links (both onDelete: Cascade).
  await prisma.project.delete({ where: { id } });
}
