import crypto from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { BadRequestError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { sendTemplateEmail } from "../email/email.service.js";
import { computeStageInfo, stageRelationsInclude, type StudentForStage } from "../students/studentStage.js";
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

// Just enough of each project's students to run computeStageInfo (see studentStage.ts) and
// derive whether *any* of them is currently 🚩 flagged (idle too long / missed session) —
// the list only needs the aggregate boolean, not each student's full stage.
const flaggedStudentsInclude = {
  students: {
    select: {
      workflowStatus: true,
      createdAt: true,
      updatedAt: true,
      isDiscontinued: true,
      discontinuedAt: true,
      user: { select: { passwordChangedAt: true } },
      ...stageRelationsInclude,
    },
  },
} as const;

function hasFlaggedStudent(students: StudentForStage[], now: Date): boolean {
  return students.some((s) => computeStageInfo(s, now).flagged);
}

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
  const projects = await prisma.project.findMany({
    where: {
      // No status filter → exclude soft-deleted (active + closed). An explicit status
      // (incl. DELETED) filters to exactly that.
      status: query.status ?? { not: "DELETED" },
    },
    include: { ...projectInclude, ...flaggedStudentsInclude },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  return projects.map(({ students, ...project }) => ({
    ...project,
    hasFlaggedStudent: hasFlaggedStudent(students, now),
  }));
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
  parentEmail: string | undefined;
  fatherName: string;
  motherName: string | null;
  tempPassword: string;
}

interface StudentSkip {
  index: number;
  reason: string;
}

interface SlotSkip {
  counsellorCode: string;
  date: string;
  startTime: string;
  reason: string;
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

  // argon2 is deliberately slow — hashing per student inside the transaction blew past
  // Prisma's 5s interactive-transaction limit on real rosters. Hash up front, in parallel;
  // rows the transaction later skips just have their hash discarded.
  const studentCreds = await Promise.all(
    input.students.map(async (s) => {
      const tempPassword = s.password ?? generateTempPassword();
      return { tempPassword, passwordHash: await argon2.hash(tempPassword) };
    })
  );

  try {
    const { project, pendingEmails, studentsSkipped, counsellorsAssigned, slotsImported, slotsSkipped } =
      await prisma.$transaction(async (tx) => {
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

        // --- Students: batch-check every row against existing Users/Students (and
        // against each other) *before* inserting anything, so a conflicting row is
        // skipped instead of aborting the whole transaction. ---
        const emails = [...new Set(input.students.map((s) => s.email))];
        const studentCodes = [...new Set(input.students.map((s) => s.studentCode))];
        const mobiles = [...new Set(input.students.map((s) => s.mobile))];

        const existingUsers = await tx.user.findMany({
          where: { email: { in: emails } },
          select: { email: true },
        });
        const existingEmails = new Set(existingUsers.map((u) => u.email));

        const existingStudents = await tx.student.findMany({
          where: { OR: [{ studentCode: { in: studentCodes } }, { mobile: { in: mobiles } }] },
          select: { studentCode: true, mobile: true },
        });
        const existingStudentCodes = new Set(existingStudents.map((s) => s.studentCode));
        const existingMobiles = new Set(existingStudents.map((s) => s.mobile));

        const studentsSkipped: StudentSkip[] = [];
        const seenEmails = new Set<string>();
        const seenStudentCodes = new Set<string>();
        const seenMobiles = new Set<string>();
        const validStudents: { row: (typeof input.students)[number]; index: number }[] = [];

        input.students.forEach((s, index) => {
          const reasons: string[] = [];
          if (existingEmails.has(s.email) || seenEmails.has(s.email)) reasons.push("email already exists");
          if (existingStudentCodes.has(s.studentCode) || seenStudentCodes.has(s.studentCode)) {
            reasons.push("studentCode already exists");
          }
          if (existingMobiles.has(s.mobile) || seenMobiles.has(s.mobile)) reasons.push("mobile already exists");

          if (reasons.length > 0) {
            studentsSkipped.push({ index, reason: reasons.join("; ") });
            return;
          }
          seenEmails.add(s.email);
          seenStudentCodes.add(s.studentCode);
          seenMobiles.add(s.mobile);
          validStudents.push({ row: s, index });
        });

        if (validStudents.length === 0) {
          throw new BadRequestError(
            "No students could be created — every row conflicted with an existing record",
            { studentsSkipped }
          );
        }

        const pendingEmails: PendingStudentEmail[] = [];
        for (const { row: s, index } of validStudents) {
          const { tempPassword, passwordHash } = studentCreds[index]!;
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

        // --- Counsellors (match-or-create by counsellorCode) + slots, each row
        // validated independently so one unknown code or one booked slot only costs
        // that row/code, not the rest of the sheet. ---
        const codes = [...rowsByCode.keys()];
        const existingCounsellors = await tx.counsellor.findMany({ where: { counsellorCode: { in: codes } } });
        const existingByCode = new Map(existingCounsellors.map((c) => [c.counsellorCode, c]));

        const existingCounsellorEmails = new Set(
          (
            await tx.user.findMany({
              // Any role — User.email is globally unique, so an existing student/admin with
              // this email blocks creating the counsellor just as much as another counsellor.
              where: {
                email: { in: [...new Set(input.counsellorSlots.map((r) => r.email).filter((v): v is string => !!v))] },
              },
              select: { email: true },
            })
          ).map((u) => u.email)
        );
        const existingCounsellorMobiles = new Set(
          (
            await tx.counsellor.findMany({
              where: {
                mobile: { in: [...new Set(input.counsellorSlots.map((r) => r.mobile).filter((v): v is string => !!v))] },
              },
              select: { mobile: true },
            })
          ).map((c) => c.mobile)
        );

        const slotsSkipped: SlotSkip[] = [];
        const seenNewCounsellorEmails = new Set<string>();
        const seenNewCounsellorMobiles = new Set<string>();
        let counsellorsAssigned = 0;
        const cleanSlots: { counsellorId: string; date: string; startTime: string; endTime: string }[] = [];

        for (const [code, rows] of rowsByCode) {
          let counsellor = existingByCode.get(code);
          const preExisting = !!counsellor;

          if (!counsellor) {
            const identityRow = rows.find((r) => r.email && r.firstName && r.lastName && r.mobile);
            let skipReason: string | undefined;
            if (!identityRow) {
              skipReason = `counsellorCode "${code}" doesn't exist yet and no row for it supplies firstName/lastName/email/mobile to create one`;
            } else if (
              existingCounsellorEmails.has(identityRow.email!) ||
              seenNewCounsellorEmails.has(identityRow.email!) ||
              seenEmails.has(identityRow.email!) // a student created earlier in this same call
            ) {
              skipReason = `counsellorCode "${code}" can't be created — email already in use`;
            } else if (
              existingCounsellorMobiles.has(identityRow.mobile!) ||
              seenNewCounsellorMobiles.has(identityRow.mobile!)
            ) {
              skipReason = `counsellorCode "${code}" can't be created — mobile already in use`;
            }

            if (skipReason) {
              for (const row of rows) {
                slotsSkipped.push({ counsellorCode: code, date: row.date, startTime: row.startTime, reason: skipReason });
              }
              continue;
            }

            seenNewCounsellorEmails.add(identityRow!.email!);
            seenNewCounsellorMobiles.add(identityRow!.mobile!);

            const passwordHash = await argon2.hash(generateTempPassword());
            const user = await tx.user.create({
              data: {
                email: identityRow!.email!,
                passwordHash,
                role: "COUNSELLOR",
                firstName: identityRow!.firstName!,
                lastName: identityRow!.lastName!,
              },
            });
            counsellor = await tx.counsellor.create({
              data: {
                userId: user.id,
                counsellorCode: code,
                mobile: identityRow!.mobile!,
                meetingLink: identityRow!.meetingLink,
              },
            });
          }

          // Slot collisions for a pre-existing counsellor only — [counsellorId, slotDate,
          // startTime] is globally unique per counsellor, not per project (addSlots in
          // sessions.service.ts pre-checks the same way). A counsellor just created above
          // can't already have slots, so skip the query.
          const existingSlots = preExisting
            ? await tx.counsellorSlot.findMany({
                where: {
                  counsellorId: counsellor.id,
                  OR: rows.map((r) => ({ slotDate: toSlotDate(r.date), startTime: r.startTime })),
                },
                select: { slotDate: true, startTime: true },
              })
            : [];
          const existingSlotKeys = new Set(
            existingSlots.map((s) => `${s.slotDate.toISOString().slice(0, 10)}|${s.startTime}`)
          );

          const seenRowKeys = new Set<string>();
          let landedForThisCode = 0;
          for (const row of rows) {
            const key = `${row.date}|${row.startTime}`;
            if (existingSlotKeys.has(key)) {
              slotsSkipped.push({
                counsellorCode: code,
                date: row.date,
                startTime: row.startTime,
                reason: "slot already booked for this counsellor",
              });
              continue;
            }
            if (seenRowKeys.has(key)) {
              slotsSkipped.push({
                counsellorCode: code,
                date: row.date,
                startTime: row.startTime,
                reason: "duplicate slot in this request",
              });
              continue;
            }
            seenRowKeys.add(key);
            cleanSlots.push({ counsellorId: counsellor.id, date: row.date, startTime: row.startTime, endTime: row.endTime });
            landedForThisCode++;
          }

          // Assignment reflects only slots that actually landed — a code that resolved
          // to a real counsellor but had every slot skipped doesn't get assigned here.
          if (landedForThisCode > 0) {
            await tx.projectCounsellor.upsert({
              where: { projectId_counsellorId: { projectId: project.id, counsellorId: counsellor.id } },
              create: { projectId: project.id, counsellorId: counsellor.id },
              update: {},
            });
            counsellorsAssigned++;
          }
        }

        if (cleanSlots.length > 0) {
          await tx.counsellorSlot.createMany({
            data: cleanSlots.map((row) => ({
              counsellorId: row.counsellorId,
              projectId: project.id,
              slotDate: toSlotDate(row.date),
              startTime: row.startTime,
              endTime: row.endTime,
            })),
          });
        }

        return {
          project,
          pendingEmails,
          studentsSkipped,
          counsellorsAssigned,
          slotsImported: cleanSlots.length,
          slotsSkipped,
        };
      }, { maxWait: 10_000, timeout: 120_000 });

    // Fire-and-forget, same as the standalone student-create endpoint — only sent once the
    // transaction has actually committed, so a rolled-back wizard never emails anyone.
    for (const s of pendingEmails) {
      // Chained, not fired independently, so WELCOME_STUDENT (which promises "details in
      // the next mail") actually goes out before LOGIN_CREDENTIALS_STUDENT — see
      // students.service.ts's createStudent for the same pattern.
      sendTemplateEmail(s.email, "WELCOME_STUDENT", {
        studentName: `${s.firstName} ${s.lastName}`,
      })
        .catch((err) => console.error(`[projects] failed to send WELCOME_STUDENT to ${s.email}:`, err))
        .finally(() => {
          sendEmailBestEffort(s.email, "LOGIN_CREDENTIALS_STUDENT", {
            studentName: `${s.firstName} ${s.lastName}`,
            loginId: s.email,
            defaultPassword: s.tempPassword,
            loginLink: env.APP_WEB_URL,
          });
        });
      if (s.parentEmail) {
        sendEmailBestEffort(s.parentEmail, "WELCOME_PARENT", {
          parentName: s.fatherName || s.motherName || "Parent",
          studentName: `${s.firstName} ${s.lastName}`,
        });
      }
      // No PRE_COUNSELLING_PARENT send here — same as the standalone student-create
      // endpoint, that email only goes out once the student confirms their profile
      // (students.service.ts confirmProfile), not at creation.
    }

    return {
      project: await getProjectById(project.id),
      studentsCreated: pendingEmails.length,
      studentsSkipped,
      counsellorsAssigned,
      slotsImported,
      slotsSkipped,
    };
  } catch (err) {
    handlePrismaError(err); // P2002 on the project's own fields (name/contactNumber/primaryEmail/code) → 409
  }
}
