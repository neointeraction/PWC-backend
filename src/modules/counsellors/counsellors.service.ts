import crypto from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { nextCode } from "../../common/utils/codeSequence.js";
import type {
  AssignProjectBody,
  CreateCounsellorInput,
  ListCounsellorsQuery,
  UpdateCounsellorInput,
} from "./counsellors.schema.js";

const counsellorInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true } },
  institute: { select: { id: true, name: true } },
  projects: {
    select: { projectId: true, project: { select: { id: true, name: true } } },
  },
} as const;

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

// Ensures every project in `projectIds` exists and belongs to `instituteId` — a
// counsellor can only be assigned to projects run by their own institute.
async function assertProjectsBelongToInstitute(projectIds: string[], instituteId: string) {
  if (projectIds.length === 0) return;
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, instituteId: true },
  });
  if (projects.length !== projectIds.length) {
    throw new BadRequestError("One or more projectIds do not exist");
  }
  const foreign = projects.filter((p) => p.instituteId !== instituteId);
  if (foreign.length > 0) {
    throw new BadRequestError("One or more projectIds do not belong to the counsellor's institute");
  }
}

export async function createCounsellor(input: CreateCounsellorInput) {
  const institute = await prisma.institute.findUnique({ where: { id: input.instituteId } });
  if (!institute) {
    throw new BadRequestError("instituteId does not exist");
  }
  const projectIds = input.projectIds ?? [];
  await assertProjectsBelongToInstitute(projectIds, input.instituteId);

  // Import sheets may carry the temp password; otherwise generate one. mustChangePassword
  // defaults to true either way, so it's changed at first login.
  const tempPassword = input.password ?? generateTempPassword();
  const passwordHash = await argon2.hash(tempPassword);

  try {
    const counsellor = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          role: "COUNSELLOR",
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });

      // Auto-generate the code (C0001, C0002, ...) unless one is supplied explicitly.
      const counsellorCode = input.counsellorCode ?? (await nextCode(tx, "COUNSELLOR"));

      return tx.counsellor.create({
        data: {
          userId: user.id,
          counsellorCode,
          instituteId: input.instituteId,
          mobile: input.mobile,
          projects: projectIds.length > 0 ? { create: projectIds.map((projectId) => ({ projectId })) } : undefined,
        },
        include: counsellorInclude,
      });
    });

    return { counsellor, tempPassword };
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listCounsellors(query: ListCounsellorsQuery) {
  return prisma.counsellor.findMany({
    where: {
      instituteId: query.instituteId,
      projects: query.projectId ? { some: { projectId: query.projectId } } : undefined,
    },
    include: counsellorInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getCounsellorById(id: string) {
  const counsellor = await prisma.counsellor.findUnique({
    where: { id },
    include: counsellorInclude,
  });
  if (!counsellor) {
    throw new NotFoundError("Counsellor not found");
  }
  return counsellor;
}

export async function updateCounsellor(id: string, input: UpdateCounsellorInput) {
  const existing = await getCounsellorById(id);
  const { firstName, lastName, isActive, mobile } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      if (firstName !== undefined || lastName !== undefined || isActive !== undefined) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: { firstName, lastName, isActive },
        });
      }
      return tx.counsellor.update({
        where: { id },
        data: { mobile },
        include: counsellorInclude,
      });
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function deleteCounsellor(id: string) {
  const existing = await getCounsellorById(id);

  // Session.counsellor is ON DELETE RESTRICT — a counsellor with booked/past sessions
  // can't be removed (it would orphan session history). Surface a clear 409 instead of a
  // raw FK error, and point the admin at deactivation (PATCH isActive:false) instead.
  const sessionCount = await prisma.session.count({ where: { counsellorId: id } });
  if (sessionCount > 0) {
    throw new ConflictError(
      "Counsellor has sessions and cannot be deleted; deactivate them instead (PATCH isActive:false)",
      { sessionCount }
    );
  }

  // Deleting the User cascades to Counsellor, its CounsellorSlots, and ProjectCounsellor
  // links (all onDelete: Cascade).
  await prisma.user.delete({ where: { id: existing.user.id } });
}

export async function assignProject(id: string, input: AssignProjectBody) {
  const counsellor = await getCounsellorById(id);
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) {
    throw new BadRequestError("projectId does not exist");
  }
  if (project.instituteId !== counsellor.instituteId) {
    throw new BadRequestError("Project does not belong to the counsellor's institute");
  }

  try {
    await prisma.projectCounsellor.create({
      data: { counsellorId: id, projectId: input.projectId },
    });
  } catch (err) {
    handlePrismaError(err); // P2002 → 409 (already assigned)
  }

  return getCounsellorById(id);
}

export async function unassignProject(id: string, projectId: string) {
  await getCounsellorById(id);
  const { count } = await prisma.projectCounsellor.deleteMany({
    where: { counsellorId: id, projectId },
  });
  if (count === 0) {
    throw new NotFoundError("Counsellor is not assigned to that project");
  }
  return getCounsellorById(id);
}
