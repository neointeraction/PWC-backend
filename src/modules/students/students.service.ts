import crypto from "node:crypto";
import argon2 from "argon2";
import type { WorkflowStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { sendTemplateEmail } from "../email/email.service.js";
import { buildFormLink } from "../../common/utils/links.js";
import { computeStageInfo, stageRelationsInclude, type StudentForStage } from "./studentStage.js";
import type {
  CheckDuplicateStudentsBody,
  CreateStudentInput,
  ListStudentsQuery,
  UpdateMyStudentInput,
  UpdateStudentInput,
} from "./students.schema.js";

const studentInclude = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      passwordChangedAt: true,
    },
  },
  project: { select: { id: true, name: true } },
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

async function assertProjectExists(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new BadRequestError("projectId does not exist");
  }
}

export async function createStudent(input: CreateStudentInput) {
  await assertProjectExists(input.projectId);

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
          className: input.className,
          divisionName: input.divisionName,
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
      className: query.className,
      divisionName: query.divisionName,
      workflowStatus: query.workflowStatus,
      isDiscontinued: query.discontinued,
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

// Bulk-upload pre-check: email/studentCode/mobile are each globally unique (see
// prisma/schema.prisma), so a match anywhere in the system — not just the project being
// created — means the row can't be inserted as-is. Runs three `IN (...)` queries (not one
// per row) so a large uploaded sheet stays cheap, then maps matches back onto each input
// row by index since a row's email/studentCode/mobile can belong to different existing
// students.
export async function checkDuplicateStudents(input: CheckDuplicateStudentsBody) {
  const { students: rows } = input;

  const emails = [...new Set(rows.map((r) => r.email).filter((v): v is string => !!v))];
  const studentCodes = [...new Set(rows.map((r) => r.studentCode).filter((v): v is string => !!v))];
  const mobiles = [...new Set(rows.map((r) => r.mobile).filter((v): v is string => !!v))];

  const existing = await prisma.student.findMany({
    where: {
      OR: [
        emails.length ? { user: { email: { in: emails } } } : undefined,
        studentCodes.length ? { studentCode: { in: studentCodes } } : undefined,
        mobiles.length ? { mobile: { in: mobiles } } : undefined,
      ].filter((clause): clause is NonNullable<typeof clause> => !!clause),
    },
    select: {
      id: true,
      studentCode: true,
      mobile: true,
      user: { select: { email: true } },
      project: { select: { id: true, name: true } },
    },
  });

  const byEmail = new Map(existing.map((s) => [s.user.email, s]));
  const byStudentCode = new Map(existing.map((s) => [s.studentCode, s]));
  const byMobile = new Map(existing.map((s) => [s.mobile, s]));

  return rows.map((row, index) => {
    const matches: {
      field: "email" | "studentCode" | "mobile";
      value: string;
      studentId: string;
      projectId: string;
      projectName: string;
    }[] = [];

    const push = (field: "email" | "studentCode" | "mobile", value: string | undefined, match: (typeof existing)[number] | undefined) => {
      if (value && match) {
        matches.push({
          field,
          value,
          studentId: match.id,
          projectId: match.project.id,
          projectName: match.project.name,
        });
      }
    };

    push("email", row.email, row.email ? byEmail.get(row.email) : undefined);
    push("studentCode", row.studentCode, row.studentCode ? byStudentCode.get(row.studentCode) : undefined);
    push("mobile", row.mobile, row.mobile ? byMobile.get(row.mobile) : undefined);

    return { index, isDuplicate: matches.length > 0, matches };
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
  const existing = await getStudentById(id); // 404 if missing

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
  const student = await getStudentById(id);

  // The parent's pre-counselling form only becomes relevant once the student has
  // confirmed their own profile is correct — sending it any earlier (e.g. at student
  // creation) would hand the parent a link before there's a real profile behind it.
  if (student.parentEmail) {
    sendEmailBestEffort(student.parentEmail, "PRE_COUNSELLING_PARENT", {
      parentName: student.fatherName || student.motherName || "Parent",
      formLink: buildFormLink("PRE_COUNSELLING_PARENT", student.id),
    });
  }

  return student;
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

// Marks a student as having dropped out of the project mid-way (transferred schools,
// opted out, ...). Deliberately independent of `workflowStatus` — see the schema comment
// on `isDiscontinued`. Data/history is preserved; this only flips the flag, so it's
// idempotent-unfriendly by design (409 on a repeat call, like confirmProfile) rather than
// silently overwriting an existing reason/timestamp.
export async function discontinueStudent(id: string, reason: string | undefined) {
  const existing = await getStudentById(id);
  if (existing.isDiscontinued) {
    throw new ConflictError("Student is already discontinued");
  }
  await prisma.student.update({
    where: { id },
    data: { isDiscontinued: true, discontinuedAt: new Date(), discontinuedReason: reason ?? null },
  });
  return getStudentById(id);
}

// Reverses discontinueStudent — clears the flag/timestamp/reason so the student's
// existing `workflowStatus` (untouched throughout) resumes driving their stage.
export async function reinstateStudent(id: string) {
  const existing = await getStudentById(id);
  if (!existing.isDiscontinued) {
    throw new ConflictError("Student is not discontinued");
  }
  await prisma.student.update({
    where: { id },
    data: { isDiscontinued: false, discontinuedAt: null, discontinuedReason: null },
  });
  return getStudentById(id);
}
