import crypto from "node:crypto";
import argon2 from "argon2";
import type { WorkflowStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import type {
  CreateStudentInput,
  ListStudentsQuery,
  UpdateStudentInput,
} from "./students.schema.js";

const studentInclude = {
  user: {
    select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
  },
  project: { select: { id: true, name: true, instituteId: true } },
  division: {
    include: { class: { select: { id: true, name: true, instituteId: true } } },
  },
} as const;

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

async function assertDivisionBelongsToProject(divisionId: string, projectId: string) {
  const [division, project] = await Promise.all([
    prisma.instituteDivision.findUnique({
      where: { id: divisionId },
      include: { class: true },
    }),
    prisma.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!project) {
    throw new BadRequestError("projectId does not exist");
  }
  if (!division || division.class.instituteId !== project.instituteId) {
    throw new BadRequestError("divisionId does not belong to the given project's institute");
  }
}

export async function createStudent(input: CreateStudentInput) {
  await assertDivisionBelongsToProject(input.divisionId, input.projectId);

  // Bulk imports may carry the temp password in the sheet; otherwise generate one.
  // Either way mustChangePassword defaults to true, so it's changed at first login.
  const tempPassword = input.password ?? generateTempPassword();
  const passwordHash = await argon2.hash(tempPassword);

  try {
    const student = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          role: "STUDENT",
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });

      return tx.student.create({
        data: {
          userId: user.id,
          studentCode: input.studentCode,
          projectId: input.projectId,
          divisionId: input.divisionId,
          mobile: input.mobile,
          whatsappNumber: input.whatsappNumber,
          parentMobile: input.parentMobile,
          parentEmail: input.parentEmail,
          // fatherName column is NOT NULL so default to ""; the others are nullable.
          fatherName: input.fatherName ?? "",
          fatherOccupation: input.fatherOccupation,
          fatherEmployer: input.fatherEmployer,
          motherName: input.motherName,
          motherOccupation: input.motherOccupation,
          motherEmployer: input.motherEmployer,
        },
        include: studentInclude,
      });
    });

    return { student, tempPassword };
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listStudents(query: ListStudentsQuery) {
  return prisma.student.findMany({
    where: {
      projectId: query.projectId,
      divisionId: query.divisionId,
      workflowStatus: query.workflowStatus,
    },
    include: studentInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getStudentById(id: string) {
  const student = await prisma.student.findUnique({
    where: { id },
    include: studentInclude,
  });
  if (!student) {
    throw new NotFoundError("Student not found");
  }
  return student;
}

export async function updateStudent(id: string, input: UpdateStudentInput) {
  const existing = await getStudentById(id);

  if (input.divisionId) {
    await assertDivisionBelongsToProject(input.divisionId, existing.projectId);
  }

  const { firstName, lastName, ...studentFields } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      if (firstName || lastName) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: { firstName, lastName },
        });
      }
      return tx.student.update({
        where: { id },
        data: studentFields,
        include: studentInclude,
      });
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function deleteStudent(id: string) {
  const existing = await getStudentById(id);

  await prisma.$transaction(async (tx) => {
    // Release any CounsellorSlot this student's sessions currently hold before the
    // cascade delete (User -> Student -> Session) removes those Session rows.
    // CounsellorSlot.sessionId is ON DELETE SET NULL at the DB level, not a release —
    // without this, the slot is left stranded at status "BOOKED" with a null
    // sessionId, permanently unbookable by anyone else.
    await tx.counsellorSlot.updateMany({
      where: { session: { studentId: id } },
      data: { status: "OPEN", sessionId: null },
    });
    // Cascades to the Student row via the userId FK's onDelete: Cascade.
    await tx.user.delete({ where: { id: existing.user.id } });
  });
}

// Student-facing action: confirms the profile data (father/mother details, parent
// contact) captured on the Student record is correct. Only legal from DRAFT — the
// underlying advanceWorkflowStatus() is idempotent/silent, but this action should
// tell a caller clearly when there's nothing to confirm.
export async function confirmProfile(id: string) {
  const existing = await getStudentById(id);
  if (existing.workflowStatus !== "DRAFT") {
    throw new ConflictError("Profile has already been confirmed");
  }
  await advanceWorkflowStatus(prisma, id, "PROFILE_COMPLETED");
  return getStudentById(id);
}

// Admin/ops override for the workflow stages that aren't wired to an automatic
// trigger yet (Sessions, Counsellor Chart/Feedback, Reports don't exist as modules).
// Unlike advanceWorkflowStatus, this is not forward-only — it's a trusted correction
// path.
export async function setWorkflowStatus(id: string, workflowStatus: WorkflowStatus) {
  await getStudentById(id);
  return prisma.student.update({
    where: { id },
    data: { workflowStatus },
    include: studentInclude,
  });
}
