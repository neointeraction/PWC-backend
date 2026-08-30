import type { CancellationReason, Prisma, SessionNumber, SessionStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
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

export async function getSession1BookingOptions(studentId: string) {
  const student = await getStudentOrThrow(studentId);
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

  const existing = await prisma.session.findMany({ where: { studentId }, select: { sessionNumber: true } });
  if (existing.length > 0) {
    throw new ConflictError("Sessions are already booked for this student");
  }

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

    const createdSession1 = await tx.session.create({
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
    const createdSession2 = await tx.session.create({
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
  // SESSION_DETAILS_PARENT (with join links) is sent once meetingLink is populated for
  // both sessions (resolved decision D — links are pasted manually, not generated at
  // booking time), not here — see setMeetingLink.

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
      division: { include: { class: { select: { name: true } } } },
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
      class: student.division.class.name,
      division: student.division.name,
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
    student: query.projectId || query.instituteId ? { projectId: query.projectId, project: query.instituteId ? { instituteId: query.instituteId } : undefined } : undefined,
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

// --- Meeting link / join / complete / notes ---

export async function setMeetingLink(id: string, meetingLink: string) {
  try {
    return await prisma.session.update({ where: { id }, data: { meetingLink }, include: sessionInclude });
  } catch (err) {
    handlePrismaError(err);
  }
}

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
  return { session: updated, meetingLink: updated.meetingLink };
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

export async function rescheduleSession(id: string, input: RescheduleSessionBody) {
  const session = await getSessionById(id);
  // Also reactivates a CANCELLED session (still locked to its counsellor) — the
  // documented "Admin cancels, student re-books" flow (resolved decision H) has no
  // other path back in, since @@unique([studentId, sessionNumber]) blocks a fresh
  // create once any row (even a cancelled one) exists for that slot.
  if (session.status !== "SCHEDULED" && session.status !== "CANCELLED") {
    throw new ConflictError(`A ${session.status.toLowerCase()} session can't be rescheduled`);
  }

  // The 24h cutoff protects an upcoming, still-live session — irrelevant when
  // reactivating a cancelled one (its old date may already be in the past).
  if (input.initiatedBy === "STUDENT" && session.status === "SCHEDULED") {
    const startsAt = combineDateTime(session.scheduledDate, session.startTime);
    const cutoff = new Date(startsAt.getTime() - RESCHEDULE_CUTOFF_HOURS * 60 * 60_000);
    if (new Date() > cutoff) {
      throw new BadRequestError(`Reschedule requests must be made at least ${RESCHEDULE_CUTOFF_HOURS} hours before the session`);
    }
  }

  const other = await prisma.session.findFirst({
    where: {
      studentId: session.studentId,
      sessionNumber: session.sessionNumber === "SESSION_1" ? "SESSION_2" : "SESSION_1",
      status: { not: "CANCELLED" },
    },
  });
  if (other) {
    const otherDateStr = other.scheduledDate.toISOString().slice(0, 10);
    if (Math.abs(diffCalendarDays(input.date, otherDateStr)) < MIN_SESSION_GAP_DAYS) {
      throw new BadRequestError(`Sessions must stay at least ${MIN_SESSION_GAP_DAYS} calendar days apart`);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const oldSlot = await tx.counsellorSlot.findUnique({ where: { sessionId: id } });

    const newSlot = await tx.counsellorSlot.findFirst({
      where: {
        counsellorId: session.counsellorId,
        slotDate: toDate(input.date),
        startTime: input.startTime,
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
      where: { id },
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
      },
      include: sessionInclude,
    });
    await tx.counsellorSlot.update({ where: { id: newSlot.id }, data: { sessionId: result.id } });
    return result;
  });

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
