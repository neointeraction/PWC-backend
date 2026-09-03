import type { CancellationReason, Prisma, SessionNumber, SessionStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import { advanceWorkflowStatus, WORKFLOW_STATUS_ORDER } from "../../common/workflow/workflowStatus.js";
import { sendTemplateEmail } from "../email/email.service.js";
import type {
  AddSlotsBody,
  BookSessionsBody,
  CancelSessionBody,
  CounsellorMyStudentsQuery,
  CreateSessionBody,
  ImportSlotsBody,
  ListSessionsQuery,
  ListSlotsQuery,
  RescheduleSessionBody,
  SendDayReminderBody,
} from "./sessions.schema.js";

const MIN_SESSION_GAP_DAYS = 2;
const JOIN_WINDOW_MINUTES_BEFORE = 10;
const RESCHEDULE_CUTOFF_HOURS = 24;

const sessionInclude = {
  student: {
    select: {
      id: true,
      studentCode: true,
      parentEmail: true,
      parentMobile: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  },
  counsellor: {
    select: {
      id: true,
      counsellorCode: true,
      meetingLink: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  },
} as const;

function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function diffCalendarDays(dateA: string, dateB: string): number {
  return Math.round((toDate(dateB).getTime() - toDate(dateA).getTime()) / 86_400_000);
}

function combineDateTime(date: Date, time: string): Date {
  const iso = date.toISOString().slice(0, 10);
  return new Date(`${iso}T${time}:00.000Z`);
}

function formatDateTime(date: string, time: string): string {
  return `${date} ${time}`;
}

// Fire-and-forget: email failures never fail the scheduling action that triggered them
// (matches the rest of the app — no persisted notification log, see
// docs/session-scheduling-use-cases.md resolved decision G).
function sendEmailBestEffort(to: string, templateKey: Parameters<typeof sendTemplateEmail>[1], data: unknown): void {
  sendTemplateEmail(to, templateKey, data).catch((err) => {
    console.error(`[sessions] failed to send ${templateKey} to ${to}:`, err);
  });
}

async function getStudentOrThrow(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  });
  if (!student) throw new NotFoundError("Student not found");
  return student;
}

async function assertProjectHasNoSlotsYet(projectId: string): Promise<void> {
  const existing = await prisma.counsellorSlot.findFirst({ where: { projectId } });
  if (existing) {
    throw new ConflictError(
      "This project's counsellor slot sheet has already been imported — it's a one-time, single upload per project"
    );
  }
}

// --- Slot import & listing ---

export async function importSlots(input: ImportSlotsBody) {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new BadRequestError("projectId does not exist");

  await assertProjectHasNoSlotsYet(input.projectId);

  const counsellorIds = [...new Set(input.slots.map((s) => s.counsellorId))];
  const assigned = await prisma.projectCounsellor.findMany({
    where: { projectId: input.projectId, counsellorId: { in: counsellorIds } },
    select: { counsellorId: true },
  });
  const assignedIds = new Set(assigned.map((a) => a.counsellorId));
  const unassigned = counsellorIds.filter((id) => !assignedIds.has(id));
  if (unassigned.length > 0) {
    throw new BadRequestError("Some counsellors are not assigned to this project", { unassignedCounsellorIds: unassigned });
  }

  try {
    const result = await prisma.counsellorSlot.createMany({
      data: input.slots.map((slot) => ({
        counsellorId: slot.counsellorId,
        projectId: input.projectId,
        slotDate: toDate(slot.date),
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),
    });
    return { imported: result.count };
  } catch (err) {
    handlePrismaError(err);
  }
}

function formatSlotDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Adds availability for a single counsellor on a project *after* the one-time import.
// The import stays one-shot (it guards against re-uploading the same sheet); this is the
// deliberate escape hatch for a counsellor assigned to the project later.
export async function addSlots(input: AddSlotsBody) {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new BadRequestError("projectId does not exist");

  const assignment = await prisma.projectCounsellor.findFirst({
    where: { projectId: input.projectId, counsellorId: input.counsellorId },
    select: { id: true },
  });
  if (!assignment) {
    throw new BadRequestError("Counsellor is not assigned to this project — assign them first via POST /counsellors/:id/projects");
  }

  // Pre-check so the admin gets back *which* rows clash, rather than a bare unique-constraint
  // 409 from createMany. The constraint is [counsellorId, slotDate, startTime] — global to the
  // counsellor, not per-project, so a clash on another project counts too.
  const existing = await prisma.counsellorSlot.findMany({
    where: {
      counsellorId: input.counsellorId,
      OR: input.slots.map((slot) => ({ slotDate: toDate(slot.date), startTime: slot.startTime })),
    },
    select: { slotDate: true, startTime: true },
  });
  if (existing.length > 0) {
    throw new ConflictError("Some of these slots already exist for this counsellor", {
      existingSlots: existing.map((slot) => ({ date: formatSlotDate(slot.slotDate), startTime: slot.startTime })),
    });
  }

  try {
    const result = await prisma.counsellorSlot.createMany({
      data: input.slots.map((slot) => ({
        counsellorId: input.counsellorId,
        projectId: input.projectId,
        slotDate: toDate(slot.date),
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),
    });
    return { added: result.count };
  } catch (err) {
    handlePrismaError(err); // P2002 → 409 (duplicate rows inside the payload itself)
  }
}

// Removes an unbooked slot from the inventory (uploaded in error, or availability no
// longer offered). A BOOKED slot is protected — cancelling its session releases it back
// to OPEN first, which keeps the student's session record the single source of truth.
export async function deleteSlot(id: string) {
  const slot = await prisma.counsellorSlot.findUnique({ where: { id } });
  if (!slot) throw new NotFoundError("Slot not found");
  if (slot.status === "BOOKED" || slot.sessionId) {
    throw new ConflictError("This slot is booked — cancel its session first, which releases the slot back to OPEN");
  }
  await prisma.counsellorSlot.delete({ where: { id } });
}

export async function listSlots(query: ListSlotsQuery) {
  return prisma.counsellorSlot.findMany({
    where: { projectId: query.projectId, counsellorId: query.counsellorId, status: query.status },
    orderBy: [{ slotDate: "asc" }, { startTime: "asc" }],
    include: { counsellor: { select: { id: true, counsellorCode: true, user: { select: { firstName: true, lastName: true } } } } },
  });
}

// --- Booking-option preview (blind for Session 1, counsellor-locked for Session 2) ---

export async function getSession1BookingOptions(studentId: string, rescheduleSessionId?: string) {
  const student = await getStudentOrThrow(studentId);

  if (rescheduleSessionId) {
    const session = await prisma.session.findUnique({ where: { id: rescheduleSessionId } });
    if (!session || session.studentId !== studentId || session.sessionNumber !== "SESSION_1") {
      throw new NotFoundError("No Session 1 found for this student with that id");
    }

    const slots = await prisma.counsellorSlot.findMany({
      where: { projectId: student.projectId, counsellorId: session.counsellorId, status: "OPEN" },
      orderBy: [{ slotDate: "asc" }, { startTime: "asc" }],
      select: { slotDate: true, startTime: true, endTime: true },
    });

    // Keep the ≥2-day gap against the other (non-cancelled) session, same rule
    // rescheduleSession/assertSessionGap enforces on submit — otherwise the preview
    // could still offer a slot that gets rejected.
    const other = await prisma.session.findFirst({
      where: { studentId, sessionNumber: "SESSION_2", status: { not: "CANCELLED" } },
    });
    if (!other) return slots;
    const otherDateStr = other.scheduledDate.toISOString().slice(0, 10);
    return slots.filter(
      (s) => Math.abs(diffCalendarDays(otherDateStr, s.slotDate.toISOString().slice(0, 10))) >= MIN_SESSION_GAP_DAYS
    );
  }

  const slots = await prisma.counsellorSlot.findMany({
    where: { projectId: student.projectId, status: "OPEN" },
    distinct: ["slotDate", "startTime", "endTime"],
    orderBy: [{ slotDate: "asc" }, { startTime: "asc" }],
    select: { slotDate: true, startTime: true, endTime: true },
  });
  return slots;
}

async function resolveCounsellorForSlot(
  db: Prisma.TransactionClient | typeof prisma,
  projectId: string,
  date: string,
  startTime: string
) {
  const slot = await db.counsellorSlot.findFirst({
    where: { projectId, slotDate: toDate(date), startTime, status: "OPEN" },
    // Tie-break: first available, in upload/creation order (resolved decision A). Same-
    // millisecond createdAt ties (e.g. a single createMany import) fall back to id, which
    // is monotonic-ish for cuids generated in sequence within the same process.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!slot) {
    throw new ConflictError("That date/time is no longer available — please pick another slot");
  }
  return slot;
}

export async function getSession2BookingOptions(studentId: string, session1Date: string, session1StartTime: string) {
  const student = await getStudentOrThrow(studentId);
  const slot1 = await resolveCounsellorForSlot(prisma, student.projectId, session1Date, session1StartTime);

  const slots = await prisma.counsellorSlot.findMany({
    where: {
      projectId: student.projectId,
      counsellorId: slot1.counsellorId,
      status: "OPEN",
      id: { not: slot1.id },
    },
    orderBy: [{ slotDate: "asc" }, { startTime: "asc" }],
    select: { slotDate: true, startTime: true, endTime: true },
  });

  return slots.filter((s) => diffCalendarDays(session1Date, s.slotDate.toISOString().slice(0, 10)) >= MIN_SESSION_GAP_DAYS);
}

// --- Booking (both sessions, one atomic flow) ---

export async function bookSessions(studentId: string, input: BookSessionsBody) {
  const student = await getStudentOrThrow(studentId);

  const studentStatusIdx = WORKFLOW_STATUS_ORDER.indexOf(student.workflowStatus);
  const assessmentCompletedIdx = WORKFLOW_STATUS_ORDER.indexOf("ASSESSMENT_COMPLETED");
  if (studentStatusIdx < assessmentCompletedIdx) {
    throw new BadRequestError(
      "Session booking unlocks after the student and parent pre-counselling forms and the assessment are all submitted"
    );
  }

  // A plain create() 409s forever once any row exists for a (studentId, sessionNumber)
  // pair (@@unique), even a cancelled one — so an *active* (non-cancelled) session
  // blocks booking, but two cancelled rows (the "restart" / Option B state, see
  // restartStudentSessions above) don't: reactivate them in place instead, same pattern
  // as createSessionManually.
  const existing = await prisma.session.findMany({ where: { studentId } });
  if (existing.some((s) => s.status !== "CANCELLED")) {
    throw new ConflictError("Sessions are already booked for this student");
  }
  const existingSession1 = existing.find((s) => s.sessionNumber === "SESSION_1");
  const existingSession2 = existing.find((s) => s.sessionNumber === "SESSION_2");

  if (diffCalendarDays(input.session1.date, input.session2.date) < MIN_SESSION_GAP_DAYS) {
    throw new BadRequestError(`Session 2 must be at least ${MIN_SESSION_GAP_DAYS} calendar days after Session 1`);
  }

  const { session1, session2, counsellor } = await prisma.$transaction(async (tx) => {
    const slot1 = await resolveCounsellorForSlot(tx, student.projectId, input.session1.date, input.session1.startTime);
    const claim1 = await tx.counsellorSlot.updateMany({ where: { id: slot1.id, status: "OPEN" }, data: { status: "BOOKED" } });
    if (claim1.count !== 1) throw new ConflictError("That Session 1 slot was just booked by someone else — please pick another");

    const slot2 = await tx.counsellorSlot.findFirst({
      where: {
        projectId: student.projectId,
        counsellorId: slot1.counsellorId,
        slotDate: toDate(input.session2.date),
        startTime: input.session2.startTime,
        status: "OPEN",
      },
    });
    if (!slot2) {
      throw new ConflictError("That Session 2 date/time isn't available for the counsellor assigned via your Session 1 pick");
    }
    const claim2 = await tx.counsellorSlot.updateMany({ where: { id: slot2.id, status: "OPEN" }, data: { status: "BOOKED" } });
    if (claim2.count !== 1) throw new ConflictError("That Session 2 slot was just booked by someone else — please pick another");

    // Fresh start (Option B): a reactivated row also clears the reschedule allowance and
    // any stale counsellor proposal, same as a single-session reschedule reactivation.
    const freshFields = {
      status: "SCHEDULED" as const,
      cancellationReason: null,
      cancellationNotes: null,
      studentJoinedAt: null,
      counsellorJoinedAt: null,
      studentNoShow: false,
      counsellorNoShow: false,
      studentRescheduleUsed: false,
      counsellorRescheduleReason: null,
      counsellorProposedDate: null,
      counsellorProposedStartTime: null,
      counsellorProposedEndTime: null,
    };

    const createdSession1 = existingSession1
      ? await tx.session.update({
          where: { id: existingSession1.id },
          data: { counsellorId: slot1.counsellorId, scheduledDate: slot1.slotDate, startTime: slot1.startTime, endTime: slot1.endTime, ...freshFields },
          include: sessionInclude,
        })
      : await tx.session.create({
          data: {
            studentId,
            counsellorId: slot1.counsellorId,
            sessionNumber: "SESSION_1",
            scheduledDate: slot1.slotDate,
            startTime: slot1.startTime,
            endTime: slot1.endTime,
          },
          include: sessionInclude,
        });
    const createdSession2 = existingSession2
      ? await tx.session.update({
          where: { id: existingSession2.id },
          data: { counsellorId: slot1.counsellorId, scheduledDate: slot2.slotDate, startTime: slot2.startTime, endTime: slot2.endTime, ...freshFields },
          include: sessionInclude,
        })
      : await tx.session.create({
          data: {
            studentId,
            counsellorId: slot1.counsellorId,
            sessionNumber: "SESSION_2",
            scheduledDate: slot2.slotDate,
            startTime: slot2.startTime,
            endTime: slot2.endTime,
          },
          include: sessionInclude,
        });

    await tx.counsellorSlot.update({ where: { id: slot1.id }, data: { sessionId: createdSession1.id } });
    await tx.counsellorSlot.update({ where: { id: slot2.id }, data: { sessionId: createdSession2.id } });

    await advanceWorkflowStatus(tx, studentId, "SESSION_SCHEDULED");

    return { session1: createdSession1, session2: createdSession2, counsellor: createdSession1.counsellor };
  });

  const studentName = `${session1.student.user.firstName} ${session1.student.user.lastName}`;
  const counsellorName = `${counsellor.user.firstName} ${counsellor.user.lastName}`;
  const s1DateTime = formatDateTime(input.session1.date, input.session1.startTime);

  sendEmailBestEffort(session1.student.user.email, "SESSION_SCHEDULED_CONFIRMATION_STUDENT", {
    studentName,
    sessionDateTime: s1DateTime,
  });
  sendEmailBestEffort(session1.student.parentEmail, "SESSION_SCHEDULED_CONFIRMATION_PARENT", {
    parentName: "Parent",
    studentName,
    sessionDateTime: s1DateTime,
  });
  sendEmailBestEffort(counsellor.user.email, "SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR", {
    counsellorName,
    studentName,
    sessionDateTime: s1DateTime,
  });
  // SESSION_DETAILS_PARENT (with join links) is still a manual POST /email/send call,
  // not sent here — the counsellor's meetingLink (session.counsellor.meetingLink) is
  // already resolvable the moment the counsellor is assigned, so there's no "populated
  // later" gate to wait on anymore (resolved decision D, superseded).

  return { session1, session2, counsellor };
}

// --- Admin manual creation (edge cases outside self-service booking) ---

// `@@unique([studentId, sessionNumber])` means a CANCELLED session's row is still
// occupying that slot — a plain create() 409s forever after a cancellation, with no
// way back in, contradicting the documented "Admin cancels, student re-books" flow
// (docs/session-scheduling-use-cases.md, resolved decision H). So this reactivates a
// CANCELLED row in place (fresh counsellor/date/time, cancellation + join/no-show
// fields cleared) instead of inserting a new one; a SCHEDULED/COMPLETED row still
// blocks with a clear 409.
export async function createSessionManually(input: CreateSessionBody) {
  await getStudentOrThrow(input.studentId);
  const counsellor = await prisma.counsellor.findUnique({ where: { id: input.counsellorId } });
  if (!counsellor) throw new BadRequestError("counsellorId does not exist");

  const existing = await prisma.session.findUnique({
    where: { studentId_sessionNumber: { studentId: input.studentId, sessionNumber: input.sessionNumber } },
  });
  if (existing && existing.status !== "CANCELLED") {
    throw new ConflictError(`Student already has a ${existing.status.toLowerCase()} ${input.sessionNumber}`);
  }

  try {
    const session = await prisma.$transaction(async (tx) => {
      const data = {
        counsellorId: input.counsellorId,
        scheduledDate: toDate(input.date),
        startTime: input.startTime,
        endTime: input.endTime,
        status: "SCHEDULED" as const,
        cancellationReason: null,
        cancellationNotes: null,
        studentJoinedAt: null,
        counsellorJoinedAt: null,
        studentNoShow: false,
        counsellorNoShow: false,
      };

      const created = existing
        ? await tx.session.update({ where: { id: existing.id }, data, include: sessionInclude })
        : await tx.session.create({
            data: { studentId: input.studentId, sessionNumber: input.sessionNumber, ...data },
            include: sessionInclude,
          });

      await advanceWorkflowStatus(tx, input.studentId, "SESSION_SCHEDULED");
      return created;
    });
    return session;
  } catch (err) {
    handlePrismaError(err);
  }
}

// --- Reads ---

function reconcileNoShow<T extends {
  id: string;
  status: SessionStatus;
  scheduledDate: Date;
  endTime: string;
  studentJoinedAt: Date | null;
  counsellorJoinedAt: Date | null;
  studentNoShow: boolean;
  counsellorNoShow: boolean;
}>(session: T): T {
  if (session.status !== "SCHEDULED") return session;
  const endsAt = combineDateTime(session.scheduledDate, session.endTime);
  if (new Date() <= endsAt) return session;

  const studentNoShow = session.studentNoShow || session.studentJoinedAt === null;
  const counsellorNoShow = session.counsellorNoShow || session.counsellorJoinedAt === null;
  if (studentNoShow === session.studentNoShow && counsellorNoShow === session.counsellorNoShow) {
    return session;
  }

  // Best-effort, lazy reconciliation (see docs/session-scheduling-use-cases.md, open
  // question E) — don't block the read on it.
  prisma.session.update({ where: { id: session.id }, data: { studentNoShow, counsellorNoShow } }).catch((err) => {
    console.error(`[sessions] failed to reconcile no-show for session ${session.id}:`, err);
  });

  return { ...session, studentNoShow, counsellorNoShow };
}

export async function getSessionById(id: string) {
  const session = await prisma.session.findUnique({ where: { id }, include: sessionInclude });
  if (!session) throw new NotFoundError("Session not found");
  return reconcileNoShow(session);
}

export async function getStudentSessions(studentId: string) {
  await getStudentOrThrow(studentId);
  const sessions = await prisma.session.findMany({
    where: { studentId },
    include: sessionInclude,
    orderBy: { sessionNumber: "asc" },
  });
  return sessions.map(reconcileNoShow);
}

export async function getCounsellorSessions(counsellorId: string, status?: SessionStatus) {
  const counsellor = await prisma.counsellor.findUnique({ where: { id: counsellorId } });
  if (!counsellor) throw new NotFoundError("Counsellor not found");
  const sessions = await prisma.session.findMany({
    where: { counsellorId, status },
    include: sessionInclude,
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });
  return sessions.map(reconcileNoShow);
}

// STUDENT_PROFILE isn't submitted through the generic form engine (it's Student
// columns, confirmed via POST /students/{id}/confirm-profile) — see
// docs/db-design.md. These 4 are what "form completion" actually tracks.
const TRACKED_FORM_TYPES = ["PRE_COUNSELLING_STUDENT", "PRE_COUNSELLING_PARENT", "FEEDBACK_STUDENT", "FEEDBACK_PARENT"] as const;

// "My Students" — a counsellor's roster across every project they're assigned to
// (via ProjectCounsellor), not just students they already have a booked Session
// with. Surfaces form/assessment/session status so a counsellor can see who's
// approaching booking-readiness, per docs/session-scheduling-use-cases.md
// Counsellor use case #7.
export async function getCounsellorMyStudents(counsellorId: string, query: CounsellorMyStudentsQuery) {
  const counsellor = await prisma.counsellor.findUnique({ where: { id: counsellorId } });
  if (!counsellor) throw new NotFoundError("Counsellor not found");

  let projectIds: string[];
  if (query.projectId) {
    const assignment = await prisma.projectCounsellor.findUnique({
      where: { projectId_counsellorId: { projectId: query.projectId, counsellorId } },
    });
    if (!assignment) throw new BadRequestError("This counsellor isn't assigned to that project");
    projectIds = [query.projectId];
  } else {
    const assignments = await prisma.projectCounsellor.findMany({ where: { counsellorId }, select: { projectId: true } });
    projectIds = assignments.map((a) => a.projectId);
  }

  const students = await prisma.student.findMany({
    where: { projectId: { in: projectIds }, workflowStatus: query.workflowStatus },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      formSubmissions: {
        where: { submittedAt: { not: null } },
        select: { formTemplate: { select: { formType: true } } },
      },
      assessmentAttempts: { where: { status: "SUBMITTED" }, select: { id: true }, take: 1 },
      sessions: {
        where: { counsellorId },
        select: { sessionNumber: true, status: true, scheduledDate: true, startTime: true },
        orderBy: { sessionNumber: "asc" },
      },
    },
    orderBy: { studentCode: "asc" },
  });

  return students.map((student) => {
    const submittedFormTypes = new Set(student.formSubmissions.map((s) => s.formTemplate.formType));
    const formsSubmitted = TRACKED_FORM_TYPES.filter((t) => submittedFormTypes.has(t)).length;

    return {
      id: student.id,
      studentCode: student.studentCode,
      firstName: student.user.firstName,
      lastName: student.user.lastName,
      email: student.user.email,
      mobile: student.mobile,
      class: student.className,
      division: student.divisionName,
      fatherName: student.fatherName,
      motherName: student.motherName,
      parentMobile: student.parentMobile,
      parentEmail: student.parentEmail,
      workflowStatus: student.workflowStatus,
      formsSubmitted,
      totalForms: TRACKED_FORM_TYPES.length,
      assessmentSubmitted: student.assessmentAttempts.length > 0,
      sessions: student.sessions,
    };
  });
}

export async function listSessions(query: ListSessionsQuery) {
  const where: Prisma.SessionWhereInput = {
    studentId: query.studentId,
    counsellorId: query.counsellorId,
    status: query.status,
    student: query.projectId ? { projectId: query.projectId } : undefined,
    studentNoShow: query.noShow === "STUDENT" ? true : undefined,
    counsellorNoShow: query.noShow === "COUNSELLOR" ? true : undefined,
  };
  if (query.from || query.to) {
    where.scheduledDate = {
      gte: query.from ? toDate(query.from) : undefined,
      lte: query.to ? toDate(query.to) : undefined,
    };
  }

  const sessions = await prisma.session.findMany({
    where,
    include: sessionInclude,
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });
  return sessions.map(reconcileNoShow);
}

// --- Join / complete / notes ---

export async function joinSession(id: string, role: "STUDENT" | "COUNSELLOR") {
  const session = await getSessionById(id);
  if (session.status !== "SCHEDULED") {
    throw new ConflictError("This session isn't currently scheduled");
  }

  const startsAt = combineDateTime(session.scheduledDate, session.startTime);
  const endsAt = combineDateTime(session.scheduledDate, session.endTime);
  const joinOpensAt = new Date(startsAt.getTime() - JOIN_WINDOW_MINUTES_BEFORE * 60_000);
  const now = new Date();

  if (now < joinOpensAt) {
    throw new BadRequestError(`Join opens ${JOIN_WINDOW_MINUTES_BEFORE} minutes before the session starts`);
  }
  if (now > endsAt) {
    throw new BadRequestError("This session has already ended");
  }

  const data = role === "STUDENT" ? { studentJoinedAt: session.studentJoinedAt ?? now } : { counsellorJoinedAt: session.counsellorJoinedAt ?? now };
  const updated = await prisma.session.update({ where: { id }, data, include: sessionInclude });

  if (role === "STUDENT") {
    sendEmailBestEffort(updated.student.parentEmail, "SESSION_JOINED_PARENT", {
      parentName: "Parent",
      studentName: `${updated.student.user.firstName} ${updated.student.user.lastName}`,
      sessionNumber: updated.sessionNumber === "SESSION_1" ? "1" : "2",
    });
  }

  return { session: updated, meetingLink: updated.counsellor.meetingLink };
}

export async function completeSession(id: string) {
  const session = await getSessionById(id);
  if (session.status !== "SCHEDULED") {
    throw new ConflictError("This session isn't currently scheduled");
  }

  const target = session.sessionNumber === "SESSION_1" ? "SESSION_1_COMPLETED" : "SESSION_2_COMPLETED";
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.session.update({ where: { id }, data: { status: "COMPLETED" }, include: sessionInclude });
    await advanceWorkflowStatus(tx, session.studentId, target);
    return result;
  });
  return updated;
}

export async function setNotes(id: string, notes: string) {
  try {
    return await prisma.session.update({ where: { id }, data: { notes }, include: sessionInclude });
  } catch (err) {
    handlePrismaError(err);
  }
}

// --- Reschedule / cancel ---

// Shared by rescheduleSession and acceptCounsellorRescheduleProposal: claims the new
// slot, releases the old one (if any), and updates the session row. Doesn't touch
// studentRescheduleUsed — callers decide whether this particular move consumes the
// student's one-time self-service allowance.
async function claimSlotAndUpdateSession(
  session: { id: string; counsellorId: string; scheduledDate: Date; startTime: string },
  targetDate: string,
  targetStartTime: string,
  extraData: Prisma.SessionUpdateInput
) {
  return prisma.$transaction(async (tx) => {
    const oldSlot = await tx.counsellorSlot.findUnique({ where: { sessionId: session.id } });

    const newSlot = await tx.counsellorSlot.findFirst({
      where: {
        counsellorId: session.counsellorId,
        slotDate: toDate(targetDate),
        startTime: targetStartTime,
        status: "OPEN",
      },
    });
    if (!newSlot) {
      throw new ConflictError("That date/time isn't available for this student's assigned counsellor");
    }
    const claim = await tx.counsellorSlot.updateMany({ where: { id: newSlot.id, status: "OPEN" }, data: { status: "BOOKED" } });
    if (claim.count !== 1) throw new ConflictError("That slot was just booked by someone else — please pick another");

    if (oldSlot) {
      await tx.counsellorSlot.update({ where: { id: oldSlot.id }, data: { status: "OPEN", sessionId: null } });
    }

    const result = await tx.session.update({
      where: { id: session.id },
      data: {
        scheduledDate: newSlot.slotDate,
        startTime: newSlot.startTime,
        endTime: newSlot.endTime,
        rescheduledFromDate: session.scheduledDate,
        rescheduledFromStart: session.startTime,
        status: "SCHEDULED",
        cancellationReason: null,
        cancellationNotes: null,
        studentJoinedAt: null,
        counsellorJoinedAt: null,
        studentNoShow: false,
        counsellorNoShow: false,
        // Any pending counsellor proposal was targeting the *old* date — stale now.
        counsellorRescheduleReason: null,
        counsellorProposedDate: null,
        counsellorProposedStartTime: null,
        counsellorProposedEndTime: null,
        ...extraData,
      },
      include: sessionInclude,
    });
    await tx.counsellorSlot.update({ where: { id: newSlot.id }, data: { sessionId: result.id } });
    return result;
  });
}

// Enforces the ≥2-day gap against the student's other (non-cancelled) session.
async function assertSessionGap(studentId: string, sessionNumber: SessionNumber, targetDate: string) {
  const other = await prisma.session.findFirst({
    where: { studentId, sessionNumber: sessionNumber === "SESSION_1" ? "SESSION_2" : "SESSION_1", status: { not: "CANCELLED" } },
  });
  if (other) {
    const otherDateStr = other.scheduledDate.toISOString().slice(0, 10);
    if (Math.abs(diffCalendarDays(targetDate, otherDateStr)) < MIN_SESSION_GAP_DAYS) {
      throw new BadRequestError(`Sessions must stay at least ${MIN_SESSION_GAP_DAYS} calendar days apart`);
    }
  }
}

export async function rescheduleSession(id: string, input: RescheduleSessionBody) {
  const session = await getSessionById(id);
  // Also reactivates a CANCELLED session (still locked to its counsellor) — the
  // documented "Admin cancels, student re-books" flow (resolved decision H) has no
  // other path back in, since @@unique([studentId, sessionNumber]) blocks a fresh
  // create once any row (even a cancelled one) exists for that slot.
  if (session.status !== "SCHEDULED" && session.status !== "CANCELLED") {
    throw new ConflictError(`A ${session.status.toLowerCase()} session can't be rescheduled`);
  }

  if (input.initiatedBy === "STUDENT" && session.status === "SCHEDULED") {
    // The 24h cutoff protects an upcoming, still-live session — irrelevant when
    // reactivating a cancelled one (its old date may already be in the past).
    const startsAt = combineDateTime(session.scheduledDate, session.startTime);
    const cutoff = new Date(startsAt.getTime() - RESCHEDULE_CUTOFF_HOURS * 60 * 60_000);
    if (new Date() > cutoff) {
      throw new BadRequestError(`Reschedule requests must be made at least ${RESCHEDULE_CUTOFF_HOURS} hours before the session`);
    }
    // "Only 1 reschedule is allowed per student" (per session — docs/Session Handling_
    // Cancellation  Rescheduling.pdf §1, Option A). A further self-service attempt
    // routes to Admin (same message shape as the 24h cutoff); Admin- or counsellor-
    // initiated reschedules aren't limited. The student's other escape hatch is Option
    // B — see restartStudentSessions below.
    if (session.studentRescheduleUsed) {
      throw new BadRequestError(
        "You've already used your one self-service reschedule for this session. Please contact Admin for further changes."
      );
    }
  }

  await assertSessionGap(session.studentId, session.sessionNumber, input.date);

  // Only a STUDENT-initiated move consumes the one-time allowance (ADMIN/COUNSELLOR
  // don't); reactivating a cancelled session is a fresh start regardless of initiator;
  // otherwise leave the flag untouched (`undefined` = not included in the update).
  const studentRescheduleUsed =
    input.initiatedBy === "STUDENT" ? true : session.status === "CANCELLED" ? false : undefined;

  const updated = await claimSlotAndUpdateSession(session, input.date, input.startTime, { studentRescheduleUsed });

  const studentName = `${updated.student.user.firstName} ${updated.student.user.lastName}`;
  const newDateTime = formatDateTime(input.date, input.startTime);
  const sessionNumberDigit = updated.sessionNumber === "SESSION_1" ? "1" : "2";

  sendEmailBestEffort(updated.student.user.email, "SESSION_RESCHEDULED_STUDENT", {
    studentName,
    sessionNumber: sessionNumberDigit,
    newDateTime,
  });
  sendEmailBestEffort(updated.student.parentEmail, "SESSION_RESCHEDULED_PARENT", {
    parentName: "Parent",
    studentName,
    sessionNumber: sessionNumberDigit,
    newDateTime,
  });

  return updated;
}

// --- Counsellor-initiated reschedule (docs/Session Handling_Cancellation  Rescheduling.pdf §3) ---
//
// A three-step handshake, distinct from the student self-service path above and not
// subject to its 1-reschedule limit: the counsellor proposes one alternative from their
// own open inventory + a reason; the student either accepts (performs the actual move)
// or declines (clears the proposal — restarting from there is the student's own next
// action, via restartStudentSessions below).

export async function requestCounsellorReschedule(
  id: string,
  input: { reason: string; date: string; startTime: string },
  actingUser: { sub: string; role: string }
) {
  const session = await getSessionById(id);
  if (session.status !== "SCHEDULED") {
    throw new ConflictError(`A ${session.status.toLowerCase()} session can't be rescheduled`);
  }

  // A counsellor may only propose for their own session; Admin can act on any.
  if (actingUser.role === "COUNSELLOR") {
    const counsellor = await prisma.counsellor.findUnique({ where: { userId: actingUser.sub } });
    if (!counsellor || counsellor.id !== session.counsellorId) {
      throw new ForbiddenError("You can only request a reschedule for your own session");
    }
  }

  // "The system shows the counsellor their own remaining open slots" — validated here
  // by requiring the proposed slot to actually belong to this session's counsellor.
  const proposedSlot = await prisma.counsellorSlot.findFirst({
    where: { counsellorId: session.counsellorId, slotDate: toDate(input.date), startTime: input.startTime, status: "OPEN" },
  });
  if (!proposedSlot) {
    throw new ConflictError("That date/time isn't one of this counsellor's own open slots");
  }
  await assertSessionGap(session.studentId, session.sessionNumber, input.date);

  const updated = await prisma.session.update({
    where: { id },
    data: {
      counsellorRescheduleReason: input.reason,
      counsellorProposedDate: proposedSlot.slotDate,
      counsellorProposedStartTime: proposedSlot.startTime,
      counsellorProposedEndTime: proposedSlot.endTime,
    },
    include: sessionInclude,
  });

  const studentName = `${updated.student.user.firstName} ${updated.student.user.lastName}`;
  const sessionNumberDigit = updated.sessionNumber === "SESSION_1" ? "1" : "2";
  const proposedDateTime = formatDateTime(input.date, input.startTime);

  sendEmailBestEffort(updated.student.user.email, "SESSION_COUNSELLOR_RESCHEDULE_REQUEST_STUDENT", {
    studentName,
    sessionNumber: sessionNumberDigit,
    reason: input.reason,
    proposedDateTime,
    portalLink: env.APP_WEB_URL,
  });

  return updated;
}

export async function acceptCounsellorRescheduleProposal(id: string) {
  const session = await getSessionById(id);
  if (!session.counsellorProposedDate || !session.counsellorProposedStartTime) {
    throw new BadRequestError("This session has no pending counsellor reschedule proposal");
  }
  if (session.status !== "SCHEDULED") {
    throw new ConflictError(`A ${session.status.toLowerCase()} session can't be rescheduled`);
  }

  const targetDate = session.counsellorProposedDate.toISOString().slice(0, 10);
  const targetStartTime = session.counsellorProposedStartTime;

  // Counsellor-initiated — doesn't touch studentRescheduleUsed.
  const updated = await claimSlotAndUpdateSession(session, targetDate, targetStartTime, {});

  const studentName = `${updated.student.user.firstName} ${updated.student.user.lastName}`;
  const newDateTime = formatDateTime(targetDate, targetStartTime);
  const sessionNumberDigit = updated.sessionNumber === "SESSION_1" ? "1" : "2";

  sendEmailBestEffort(updated.student.user.email, "SESSION_RESCHEDULED_STUDENT", {
    studentName,
    sessionNumber: sessionNumberDigit,
    newDateTime,
  });
  sendEmailBestEffort(updated.student.parentEmail, "SESSION_RESCHEDULED_PARENT", {
    parentName: "Parent",
    studentName,
    sessionNumber: sessionNumberDigit,
    newDateTime,
  });

  return updated;
}

export async function declineCounsellorRescheduleProposal(id: string) {
  const session = await getSessionById(id);
  if (!session.counsellorProposedDate) {
    throw new BadRequestError("This session has no pending counsellor reschedule proposal");
  }
  return prisma.session.update({
    where: { id },
    data: {
      counsellorRescheduleReason: null,
      counsellorProposedDate: null,
      counsellorProposedStartTime: null,
      counsellorProposedEndTime: null,
    },
    include: sessionInclude,
  });
}

// --- Restart (docs/Session Handling_Cancellation  Rescheduling.pdf §1, Option B) ---
//
// "Before starting Session 1, both Session 1 and Session 2 are cancelled together and
// the student starts fresh, rebooking both against current availability." The escape
// hatch when the 1-reschedule limit isn't enough, or a counsellor's proposal doesn't
// work for the student. Cancels both sessions in one transaction; bookSessions (below)
// is what allows rebooking afterward — it reactivates these rows once both are
// CANCELLED rather than blocking on "sessions already booked".

export async function restartStudentSessions(studentId: string) {
  const sessions = await prisma.session.findMany({ where: { studentId }, include: sessionInclude });
  const session1 = sessions.find((s) => s.sessionNumber === "SESSION_1");
  if (!session1) {
    throw new NotFoundError("This student has no Session 1 to restart from");
  }
  if (session1.status === "COMPLETED" || session1.studentJoinedAt || session1.counsellorJoinedAt) {
    throw new ConflictError("Session 1 has already started — restart is only available before then");
  }

  const activeSessions = sessions.filter((s) => s.status !== "CANCELLED");
  if (activeSessions.length === 0) {
    throw new ConflictError("There's nothing to restart — both sessions are already cancelled");
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const s of activeSessions) {
      const slot = await tx.counsellorSlot.findUnique({ where: { sessionId: s.id } });
      if (slot) {
        await tx.counsellorSlot.update({ where: { id: slot.id }, data: { status: "OPEN", sessionId: null } });
      }
      results.push(
        await tx.session.update({
          where: { id: s.id },
          data: {
            status: "CANCELLED",
            cancellationReason: "OTHER",
            cancellationNotes: "Student restarted booking from scratch (Option B)",
            counsellorRescheduleReason: null,
            counsellorProposedDate: null,
            counsellorProposedStartTime: null,
            counsellorProposedEndTime: null,
          },
          include: sessionInclude,
        })
      );
    }
    return results;
  });

  const studentName = `${session1.student.user.firstName} ${session1.student.user.lastName}`;
  for (const s of cancelled) {
    const originalDateTime = formatDateTime(s.scheduledDate.toISOString().slice(0, 10), s.startTime);
    const sessionNumberDigit = s.sessionNumber === "SESSION_1" ? "1" : "2";
    sendEmailBestEffort(s.student.user.email, "SESSION_CANCELLED_STUDENT", { studentName, sessionNumber: sessionNumberDigit, originalDateTime });
    sendEmailBestEffort(s.student.parentEmail, "SESSION_CANCELLED_PARENT", { parentName: "Parent", studentName, sessionNumber: sessionNumberDigit, originalDateTime });
  }

  return { cancelled };
}

export async function cancelSession(id: string, input: CancelSessionBody) {
  const session = await getSessionById(id);
  if (session.status === "CANCELLED" || session.status === "COMPLETED") {
    throw new ConflictError(`This session is already ${session.status.toLowerCase()}`);
  }

  const originalDateTime = formatDateTime(session.scheduledDate.toISOString().slice(0, 10), session.startTime);

  const updated = await prisma.$transaction(async (tx) => {
    const slot = await tx.counsellorSlot.findUnique({ where: { sessionId: id } });
    if (slot) {
      await tx.counsellorSlot.update({ where: { id: slot.id }, data: { status: "OPEN", sessionId: null } });
    }
    return tx.session.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancellationReason: input.reason as CancellationReason,
        cancellationNotes: input.notes,
        // A pending counsellor proposal is moot once the session itself is cancelled.
        counsellorRescheduleReason: null,
        counsellorProposedDate: null,
        counsellorProposedStartTime: null,
        counsellorProposedEndTime: null,
      },
      include: sessionInclude,
    });
  });

  const studentName = `${updated.student.user.firstName} ${updated.student.user.lastName}`;
  const sessionNumberDigit = updated.sessionNumber === "SESSION_1" ? "1" : "2";

  sendEmailBestEffort(updated.student.user.email, "SESSION_CANCELLED_STUDENT", {
    studentName,
    sessionNumber: sessionNumberDigit,
    originalDateTime,
  });
  sendEmailBestEffort(updated.student.parentEmail, "SESSION_CANCELLED_PARENT", {
    parentName: "Parent",
    studentName,
    sessionNumber: sessionNumberDigit,
    originalDateTime,
  });

  return updated;
}

// --- No-show tracking (docs/Session Handling_Cancellation  Rescheduling.pdf §2, §4) ---
//
// Complements the passive, lazy `reconcileNoShow` above (which silently backfills the
// flags whenever a session is read after it ends): this is the explicit, immediate path
// — "the counsellor marks 'Student did not join' from their session screen at or after
// the scheduled time" — with the notification side effects the doc requires. Marking
// doesn't change `status`; the session stays SCHEDULED (a no-show is a fact about what
// happened, not itself a cancellation) until someone reschedules or cancels it via the
// existing endpoints.

export async function markSessionNoShow(id: string, party: "STUDENT" | "COUNSELLOR") {
  const session = await getSessionById(id);
  if (session.status !== "SCHEDULED") {
    throw new ConflictError(`A ${session.status.toLowerCase()} session can't be marked no-show`);
  }
  const startsAt = combineDateTime(session.scheduledDate, session.startTime);
  if (new Date() < startsAt) {
    throw new BadRequestError("A session can only be marked no-show at or after its scheduled start time");
  }

  // Idempotent: already flagged for this party — return as-is, no duplicate alerts.
  if (party === "STUDENT" ? session.studentNoShow : session.counsellorNoShow) {
    return session;
  }

  const updated = await prisma.session.update({
    where: { id },
    data: party === "STUDENT" ? { studentNoShow: true } : { counsellorNoShow: true },
    include: sessionInclude,
  });

  const studentName = `${updated.student.user.firstName} ${updated.student.user.lastName}`;
  const counsellorName = `${updated.counsellor.user.firstName} ${updated.counsellor.user.lastName}`;
  const sessionNumberDigit = updated.sessionNumber === "SESSION_1" ? "1" : "2";
  const sessionDateTime = formatDateTime(updated.scheduledDate.toISOString().slice(0, 10), updated.startTime);

  if (party === "STUDENT") {
    // "That single occurrence is auto-flagged to Admin." The reschedule prompt itself
    // waits for sendNoShowReschedulePrompt (Admin-only) — "once Admin permits."
    sendEmailBestEffort(env.ADMIN_NOTIFICATION_EMAIL, "SESSION_STUDENT_NO_SHOW_ADMIN", {
      studentName,
      counsellorName,
      sessionNumber: sessionNumberDigit,
      sessionDateTime,
    });
  } else {
    // Counsellor no-show "should always route to Admin every time, without exception"
    // AND the student gets an apology + reschedule prompt immediately, with no Admin
    // gate — "so the student isn't left waiting on Admin before they can rebook."
    sendEmailBestEffort(env.ADMIN_NOTIFICATION_EMAIL, "SESSION_COUNSELLOR_NO_SHOW_ADMIN", {
      studentName,
      counsellorName,
      sessionNumber: sessionNumberDigit,
      sessionDateTime,
    });
    sendEmailBestEffort(updated.student.user.email, "SESSION_COUNSELLOR_NO_SHOW_STUDENT", {
      studentName,
      sessionDateTime,
      portalLink: env.APP_WEB_URL,
    });
  }

  return updated;
}

// Admin explicitly "permitting" the reschedule prompt IS this call — no separate
// persisted approval flag, matching the app's fire-and-forget/no-log convention
// (docs/session-scheduling-use-cases.md resolved decision G).
export async function sendNoShowReschedulePrompt(id: string) {
  const session = await getSessionById(id);
  if (!session.studentNoShow) {
    throw new BadRequestError("This session hasn't been marked as a student no-show");
  }

  const studentName = `${session.student.user.firstName} ${session.student.user.lastName}`;
  const sessionDateTime = formatDateTime(session.scheduledDate.toISOString().slice(0, 10), session.startTime);

  sendEmailBestEffort(session.student.user.email, "SESSION_MISSED_STUDENT", {
    studentName,
    sessionDateTime,
    portalLink: env.APP_WEB_URL,
  });

  return { sent: true };
}

// --- Day-of reminder (manual trigger — no scheduler exists yet, see email module README) ---

export async function sendDayReminder(id: string, input: SendDayReminderBody) {
  const session = await getSessionById(id);
  const studentName = `${session.student.user.firstName} ${session.student.user.lastName}`;
  const counsellorName = `${session.counsellor.user.firstName} ${session.counsellor.user.lastName}`;
  const sessionTemplateStudent = session.sessionNumber === "SESSION_1" ? "SESSION_1_DAY_REMINDER_STUDENT" : "SESSION_2_DAY_REMINDER_STUDENT";
  const sessionTemplateParent = session.sessionNumber === "SESSION_1" ? "SESSION_1_DAY_REMINDER_PARENT" : "SESSION_2_DAY_REMINDER_PARENT";
  const sessionTemplateCounsellor = session.sessionNumber === "SESSION_1" ? "SESSION_1_DAY_REMINDER_COUNSELLOR" : "SESSION_2_DAY_REMINDER_COUNSELLOR";

  sendEmailBestEffort(session.student.user.email, sessionTemplateStudent, {
    studentName,
    sessionTime: session.startTime,
    portalLink: input.portalLink,
  });
  sendEmailBestEffort(session.student.parentEmail, sessionTemplateParent, {
    parentName: "Parent",
    studentName,
    sessionTime: session.startTime,
  });
  sendEmailBestEffort(session.counsellor.user.email, sessionTemplateCounsellor, {
    counsellorName,
    studentName,
    sessionTime: session.startTime,
    portalLink: input.portalLink,
  });

  return { sent: true };
}

export type { SessionNumber };
