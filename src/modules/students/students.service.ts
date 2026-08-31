import crypto from "node:crypto";
import argon2 from "argon2";
import type { WorkflowStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { nextCode } from "../../common/utils/codeSequence.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { sendTemplateEmail } from "../email/email.service.js";
import { computeStageInfo, stageRelationsInclude, type StudentForStage } from "./studentStage.js";
import type {
  CreateStudentInput,
  ListStudentsQuery,
  UpdateMyStudentInput,
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

// Fire-and-forget: email failures never fail student creation (same pattern as
// sessions.service.ts's sendEmailBestEffort — no persisted notification log).
function sendEmailBestEffort(to: string, templateKey: Parameters<typeof sendTemplateEmail>[1], data: unknown): void {
  sendTemplateEmail(to, templateKey, data).catch((err) => {
    console.error(`[students] failed to send ${templateKey} to ${to}:`, err);
  });
}

// Attaches the derived stage + ageing/flag (computeStageInfo) to a student loaded with
// `stageRelationsInclude`, and strips the raw child rows the resolver read — the response
// carries the display relations (user/project/division) plus `stageInfo`, nothing heavier.
function attachStageInfo<T extends StudentForStage>(student: T, now: Date) {
  const { formSubmissions, assessmentAttempts, sessions, ...rest } = student;
  void formSubmissions;
  void assessmentAttempts;
  void sessions;
  return { ...rest, stageInfo: computeStageInfo(student, now) };
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

      // Auto-generate the login code (S0001, S0002, ...) unless one is supplied
      // explicitly (kept as an override for migrations/imports carrying legacy codes).
      const studentCode = input.studentCode ?? (await nextCode(tx, "STUDENT"));

      return tx.student.create({
        data: {
          userId: user.id,
          studentCode,
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

    sendEmailBestEffort(student.user.email, "LOGIN_CREDENTIALS_STUDENT", {
      studentName: `${student.user.firstName} ${student.user.lastName}`,
      loginId: student.user.email,
      defaultPassword: tempPassword,
      loginLink: env.APP_WEB_URL,
    });

    return { student, tempPassword };
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listStudents(query: ListStudentsQuery) {
  const students = await prisma.student.findMany({
    where: {
      projectId: query.projectId,
      divisionId: query.divisionId,
      workflowStatus: query.workflowStatus,
    },
    include: { ...studentInclude, ...stageRelationsInclude },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const enriched = students.map((s) => attachStageInfo(s, now));

  // The derived-stage dropdown (`stage`) and the 🚩 toggle (`flagged`) filter on computed
  // values, so they run here rather than in the SQL WHERE. `workflowStatus` (raw enum)
  // stays in the query above for callers that still filter by it.
  return enriched.filter((s) => {
    if (query.stage && s.stageInfo.stage !== query.stage) return false;
    if (query.flagged !== undefined && s.stageInfo.flagged !== query.flagged) return false;
    return true;
  });
}

export async function getStudentById(id: string) {
  const student = await prisma.student.findUnique({
    where: { id },
    include: { ...studentInclude, ...stageRelationsInclude },
  });
  if (!student) {
    throw new NotFoundError("Student not found");
  }
  return attachStageInfo(student, new Date());
}

// Student self-service: resolve the logged-in user's own Student record from their
// User.id (the access token's `sub`). This is the entry point every student-facing page
// needs — it hands the frontend the Student.id, project, division, cohort and workflow
// stage that all the downstream `:studentId`-keyed routes (forms, assessment, sessions)
// require. 404s for a non-student user (staff have no Student row).
export async function getStudentByUserId(userId: string) {
  const student = await prisma.student.findUnique({
    where: { userId },
    include: { ...studentInclude, ...stageRelationsInclude },
  });
  if (!student) {
    throw new NotFoundError("No student profile is linked to this account");
  }
  const withStage = attachStageInfo(student, new Date());
  // Cohort isn't stored per-student yet (single active cohort today); surface the active
  // cohort code so the frontend can request the right form/assessment bank.
  const cohort = await prisma.cohort.findFirst({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { code: true, name: true },
  });
  return { ...withStage, cohort };
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

// Student self-service edit: the logged-in student updates their own parent/guardian
// details and WhatsApp number. Resolves the Student row from the token's User.id and only
// touches the whitelisted fields in `updateMyStudentSchema` — identity/enrolment fields
// stay admin-only. Allowed at any workflow stage (contact details can change over time).
export async function updateMyStudent(userId: string, input: UpdateMyStudentInput) {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!student) {
    throw new NotFoundError("No student profile is linked to this account");
  }
  try {
    await prisma.student.update({
      where: { id: student.id },
      data: input,
    });
  } catch (err) {
    handlePrismaError(err);
  }
  // Return the same enriched shape (stage + cohort) the student page already consumes.
  return getStudentByUserId(userId);
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
