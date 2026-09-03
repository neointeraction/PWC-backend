import crypto from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { BadRequestError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { sendTemplateEmail } from "../email/email.service.js";
import type {
  CreateProjectInput,
  CreateProjectWizardInput,
  ListProjectsQuery,
  UpdateProjectInput,
  WizardCounsellorSlot,
} from "./projects.schema.js";

const projectInclude = {
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
  const languageId = await resolveLanguageId(input.languageId);

  try {
    return await prisma.project.create({
      data: {
        code: input.code,
        name: input.name,
        address: input.address ?? "",
        contactNumber: input.contactNumber,
        primaryEmail: input.primaryEmail,
        fromDate: input.fromDate,
        toDate: input.toDate,
        status: input.status,
        languageId,
      },
      include: projectInclude,
    });
  } catch (err) {
    handlePrismaError(err); // P2002 on name/contactNumber/primaryEmail/code → 409
  }
}

export async function listProjects(query: ListProjectsQuery) {
  return prisma.project.findMany({
    where: {
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
        address: input.address,
        contactNumber: input.contactNumber,
        primaryEmail: input.primaryEmail,
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

// Hard-delete: permanently purges the project and every row scoped to it (students, their
// User accounts, sessions, counsellor slots, form submissions/answers, assessment attempts/
// answers/results, counsellor charts/notes, reports, ProjectCounsellor links). Irreversible,
// so only allowed once the project is already CLOSED (or previously soft-deleted) — distinct
// from deleteProject() above, which must stay reversible for the "close then maybe reopen"
// flow.
//
// The Student → User FK is ON DELETE CASCADE in that direction only (deleting a User cascades
// to its Student, not the other way round), so a plain `project.delete()` would leave the
// students' User rows orphaned. We delete those User rows explicitly first — that cascades
// Student and everything scoped to it (sessions, form/assessment/chart/report data) — then
// delete the Project row itself, which cascades ProjectCounsellor and any remaining counsellor
// slots. Counsellor rows and their own User accounts are never touched: ProjectCounsellor only
// cascades from Counsellor, not from Project.
export async function purgeProject(id: string) {
  const existing = await getProjectById(id); // 404 if missing
  if (existing.status !== "CLOSED" && existing.status !== "DELETED") {
    throw new BadRequestError("Only a CLOSED or DELETED project can be purged");
  }

  await prisma.$transaction(async (tx) => {
    const students = await tx.student.findMany({ where: { projectId: id }, select: { userId: true } });
    if (students.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: students.map((s) => s.userId) } } });
    }
    await tx.project.delete({ where: { id } });
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

// --- Combined wizard: create the project + onboard students + import counsellor slots ---
// in one transaction. See projects.schema.ts for the payload shape and rationale.

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function sendEmailBestEffort(to: string, templateKey: Parameters<typeof sendTemplateEmail>[1], data: unknown): void {
  sendTemplateEmail(to, templateKey, data).catch((err) => {
    console.error(`[projects] failed to send ${templateKey} to ${to}:`, err);
  });
}

function toSlotDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

interface PendingStudentEmail {
  email: string;
  firstName: string;
  lastName: string;
  parentEmail: string;
  fatherName: string;
  motherName: string | null;
  tempPassword: string;
}

export async function createProjectWizard(input: CreateProjectWizardInput) {
  const languageId = await resolveLanguageId(input.project.languageId);

  // Group counsellor-availability rows by counsellorCode — rows sharing a code are the
  // same counsellor's slots.
  const rowsByCode = new Map<string, WizardCounsellorSlot[]>();
  for (const row of input.counsellorSlots) {
    const existing = rowsByCode.get(row.counsellorCode);
    if (existing) existing.push(row);
    else rowsByCode.set(row.counsellorCode, [row]);
  }

  try {
    const { project, pendingEmails } = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          code: input.project.code,
          name: input.project.name,
          address: input.project.address ?? "",
          contactNumber: input.project.contactNumber,
          primaryEmail: input.project.primaryEmail,
          fromDate: input.project.fromDate,
          toDate: input.project.toDate,
          status: input.project.status,
          languageId,
        },
      });

      // --- Students ---
      const pendingEmails: PendingStudentEmail[] = [];
      for (const s of input.students) {
        const tempPassword = s.password ?? generateTempPassword();
        const passwordHash = await argon2.hash(tempPassword);
        const user = await tx.user.create({
          data: { email: s.email, passwordHash, role: "STUDENT", firstName: s.firstName, lastName: s.lastName },
        });
        await tx.student.create({
          data: {
            userId: user.id,
            studentCode: s.studentCode,
            projectId: project.id,
            className: s.className,
            divisionName: s.divisionName,
            mobile: s.mobile,
            whatsappNumber: s.whatsappNumber,
            parentMobile: s.parentMobile,
            parentEmail: s.parentEmail,
            // fatherName column is NOT NULL so default to ""; the others are nullable —
            // mirrors createStudent in students.service.ts.
            fatherName: s.fatherName ?? "",
            fatherOccupation: s.fatherOccupation,
            fatherEmployer: s.fatherEmployer,
            motherName: s.motherName,
            motherOccupation: s.motherOccupation,
            motherEmployer: s.motherEmployer,
          },
        });
        pendingEmails.push({
          email: s.email,
          firstName: s.firstName,
          lastName: s.lastName,
          parentEmail: s.parentEmail,
          fatherName: s.fatherName ?? "",
          motherName: s.motherName ?? null,
          tempPassword,
        });
      }

      // --- Counsellors (match-or-create by counsellorCode) + project assignment ---
      const counsellorIdByCode = new Map<string, string>();
      for (const [code, rows] of rowsByCode) {
        let counsellor = await tx.counsellor.findUnique({ where: { counsellorCode: code } });
        if (!counsellor) {
          const identityRow = rows.find((r) => r.email && r.firstName && r.lastName && r.mobile);
          if (!identityRow) {
            throw new BadRequestError(
              `Counsellor "${code}" doesn't exist yet — at least one row for this counsellorCode needs firstName, lastName, email and mobile so it can be created`
            );
          }
          const passwordHash = await argon2.hash(generateTempPassword());
          const user = await tx.user.create({
            data: {
              email: identityRow.email!,
              passwordHash,
              role: "COUNSELLOR",
              firstName: identityRow.firstName!,
              lastName: identityRow.lastName!,
            },
          });
          counsellor = await tx.counsellor.create({
            data: {
              userId: user.id,
              counsellorCode: code,
              mobile: identityRow.mobile!,
              meetingLink: identityRow.meetingLink,
            },
          });
        }
        counsellorIdByCode.set(code, counsellor.id);

        await tx.projectCounsellor.upsert({
          where: { projectId_counsellorId: { projectId: project.id, counsellorId: counsellor.id } },
          create: { projectId: project.id, counsellorId: counsellor.id },
          update: {},
        });
      }

      // --- Slots ---
      if (input.counsellorSlots.length > 0) {
        await tx.counsellorSlot.createMany({
          data: input.counsellorSlots.map((row) => ({
            counsellorId: counsellorIdByCode.get(row.counsellorCode)!,
            projectId: project.id,
            slotDate: toSlotDate(row.date),
            startTime: row.startTime,
            endTime: row.endTime,
          })),
        });
      }

      return { project, pendingEmails };
    });

    // Fire-and-forget, same as the standalone student-create endpoint — only sent once the
    // transaction has actually committed, so a rolled-back wizard never emails anyone.
    for (const s of pendingEmails) {
      sendEmailBestEffort(s.email, "LOGIN_CREDENTIALS_STUDENT", {
        studentName: `${s.firstName} ${s.lastName}`,
        loginId: s.email,
        defaultPassword: s.tempPassword,
        loginLink: env.APP_WEB_URL,
      });
      sendEmailBestEffort(s.parentEmail, "PRE_COUNSELLING_PARENT", {
        parentName: s.fatherName || s.motherName || "Parent",
        formLink: env.APP_WEB_URL,
      });
    }

    return {
      project: await getProjectById(project.id),
      studentsCreated: pendingEmails.length,
      counsellorsAssigned: rowsByCode.size,
      slotsImported: input.counsellorSlots.length,
    };
  } catch (err) {
    handlePrismaError(err); // P2002 on any unique field (email/mobile/code/...) → 409
  }
}
