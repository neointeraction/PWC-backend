import crypto from "node:crypto";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { sendTemplateEmail } from "../email/email.service.js";
import type {
  AssignProjectBody,
  CreateCounsellorInput,
  ListCounsellorsQuery,
  UpdateCounsellorInput,
} from "./counsellors.schema.js";
import { fullName } from "../../common/utils/fullName.js";

const counsellorInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true } },
  projects: {
    select: { projectId: true, project: { select: { id: true, name: true } } },
  },
} as const;

type CounsellorWithProjects = Prisma.CounsellorGetPayload<{ include: typeof counsellorInclude }>;

// Sessions that still count against a counsellor's per-session "balance": booked and not
// yet done. RESCHEDULED is included defensively (the booking flow keeps a moved session
// SCHEDULED today, but the enum value exists).
const OPEN_SESSION_STATUSES = ["SCHEDULED", "RESCHEDULED"] as const;

// Annotates each counsellor's projects[] entry with workload counts for the admin
// "Deployment & Workload Breakdown" view:
//   totalAllotted   — students in this project allotted to this counsellor: distinct
//                     students with a non-cancelled Session 1 or 2 on them. Counted from
//                     sessions, not CounsellorSlot rows — an admin can create a session
//                     directly with no slot (createSessionManually), open slots aren't
//                     students, and each student takes two slots, so a slot count never
//                     lined up with the students listed for the counsellor.
//   session1Balance — SESSION_1 sessions on this counsellor, for students in this project,
//                     still SCHEDULED/RESCHEDULED (i.e. not completed or cancelled)
//   session2Balance — same, for SESSION_2
// Two grouped queries for the whole page, never one per counsellor. Session has no
// projectId of its own — the project comes from the student — so both are raw SQL
// (Prisma's groupBy can't group by a relation field).
async function withWorkload(counsellors: CounsellorWithProjects[]) {
  const ids = counsellors.map((c) => c.id);
  if (ids.length === 0) return [];

  const [studentCounts, sessionCounts] = await Promise.all([
    prisma.$queryRaw<{ counsellorId: string; projectId: string; count: number }[]>`
      SELECT s."counsellorId", st."projectId", COUNT(DISTINCT s."studentId")::int AS count
      FROM sessions s
      JOIN students st ON st.id = s."studentId"
      WHERE s."counsellorId" IN (${Prisma.join(ids)})
        AND s.status::text <> 'CANCELLED'
      GROUP BY s."counsellorId", st."projectId"
    `,
    prisma.$queryRaw<{ counsellorId: string; projectId: string; sessionNumber: string; count: number }[]>`
      SELECT s."counsellorId", st."projectId", s."sessionNumber"::text AS "sessionNumber", COUNT(*)::int AS count
      FROM sessions s
      JOIN students st ON st.id = s."studentId"
      WHERE s."counsellorId" IN (${Prisma.join(ids)})
        AND s.status::text IN (${Prisma.join([...OPEN_SESSION_STATUSES])})
      GROUP BY s."counsellorId", st."projectId", s."sessionNumber"
    `,
  ]);

  const key = (counsellorId: string, projectId: string) => `${counsellorId}:${projectId}`;
  const students = new Map(studentCounts.map((r) => [key(r.counsellorId, r.projectId), r.count]));
  const s1 = new Map<string, number>();
  const s2 = new Map<string, number>();
  for (const r of sessionCounts) {
    (r.sessionNumber === "SESSION_1" ? s1 : s2).set(key(r.counsellorId, r.projectId), r.count);
  }

  return counsellors.map((c) => ({
    ...c,
    projects: c.projects.map((p) => {
      const k = key(c.id, p.projectId);
      return {
        ...p,
        totalAllotted: students.get(k) ?? 0,
        session1Balance: s1.get(k) ?? 0,
        session2Balance: s2.get(k) ?? 0,
      };
    }),
  }));
}

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

// Fire-and-forget: email failures never fail counsellor creation (same pattern as
// students.service.ts's sendEmailBestEffort — no persisted notification log).
function sendEmailBestEffort(to: string, templateKey: Parameters<typeof sendTemplateEmail>[1], data: unknown): void {
  sendTemplateEmail(to, templateKey, data).catch((err) => {
    console.error(`[counsellors] failed to send ${templateKey} to ${to}:`, err);
  });
}

// Ensures every project in `projectIds` exists. Counsellors are a flat, tenant-wide
// directory, so this is the only project-existence check needed.
async function assertProjectsExist(projectIds: string[]) {
  if (projectIds.length === 0) return;
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true },
  });
  if (projects.length !== projectIds.length) {
    throw new BadRequestError("One or more projectIds do not exist");
  }
}

export async function createCounsellor(input: CreateCounsellorInput) {
  const projectIds = input.projectIds ?? [];
  await assertProjectsExist(projectIds);

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

      return tx.counsellor.create({
        data: {
          userId: user.id,
          counsellorCode: input.counsellorCode,
          mobile: input.mobile,
          meetingLink: input.meetingLink,
          projects: projectIds.length > 0 ? { create: projectIds.map((projectId) => ({ projectId })) } : undefined,
        },
        include: counsellorInclude,
      });
    });

    sendEmailBestEffort(counsellor.user.email, "LOGIN_CREDENTIALS_COUNSELLOR", {
      counsellorName: fullName(counsellor.user),
      loginId: counsellor.user.email,
      defaultPassword: tempPassword,
      loginLink: env.APP_WEB_URL,
    });

    return { counsellor, tempPassword };
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listCounsellors(query: ListCounsellorsQuery) {
  const counsellors = await prisma.counsellor.findMany({
    where: {
      projects: query.projectId ? { some: { projectId: query.projectId } } : undefined,
    },
    include: counsellorInclude,
    orderBy: { createdAt: "desc" },
  });
  return withWorkload(counsellors);
}

export async function getCounsellorById(id: string) {
  const counsellor = await prisma.counsellor.findUnique({
    where: { id },
    include: counsellorInclude,
  });
  if (!counsellor) {
    throw new NotFoundError("Counsellor not found");
  }
  const [withCounts] = await withWorkload([counsellor]);
  return withCounts!;
}

// Self-service: resolves the logged-in COUNSELLOR user to their Counsellor row, the same
// way getStudentByUserId does for students — the frontend has the User id from the JWT,
// not the Counsellor id that session/chart/feedback routes are keyed on.
export async function getCounsellorByUserId(userId: string) {
  const counsellor = await prisma.counsellor.findUnique({
    where: { userId },
    include: counsellorInclude,
  });
  if (!counsellor) {
    throw new NotFoundError("No counsellor profile is linked to this account");
  }
  const [withCounts] = await withWorkload([counsellor]);
  return withCounts!;
}

export async function updateCounsellor(id: string, input: UpdateCounsellorInput) {
  const existing = await getCounsellorById(id);
  const { firstName, lastName, isActive, mobile, meetingLink } = input;

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
        data: { mobile, meetingLink },
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
  await getCounsellorById(id);
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) {
    throw new BadRequestError("projectId does not exist");
  }

  // Counsellors are tenant-wide: the same counsellor can be assigned to any number of
  // projects concurrently. Assigning a project the counsellor is already on is a no-op,
  // not an error — this lets callers (e.g. re-running a slot import) freely re-assign
  // without first checking whether the link exists.
  const existingLink = await prisma.projectCounsellor.findUnique({
    where: { projectId_counsellorId: { projectId: input.projectId, counsellorId: id } },
  });
  if (!existingLink) {
    try {
      await prisma.projectCounsellor.create({
        data: { counsellorId: id, projectId: input.projectId },
      });
    } catch (err) {
      handlePrismaError(err);
    }
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
