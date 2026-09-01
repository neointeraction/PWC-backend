import { z } from "zod";
import { workflowStatusSchema } from "../students/students.schema.js";

// "HH:mm", 24h — matches CounsellorSlot/Session.startTime/endTime.
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm 24h format");

// Accepts either machine form "YYYY-MM-DD" or the display form "01 Aug 2026" that responses
// now emit (so a slot picked from a booking-options response can be sent straight back), and
// always normalizes to "YYYY-MM-DD" for the service layer.
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const dateSchema = z
  .string()
  .trim()
  .transform((val, ctx) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = /^(\d{2}) ([A-Za-z]{3}) (\d{4})$/.exec(val);
    if (m) {
      const [, day, mon, year] = m;
      const month = MONTHS[mon!.toLowerCase()];
      if (month) return `${year}-${month}-${day}`;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date must be in YYYY-MM-DD or DD Mon YYYY format" });
    return z.NEVER;
  });

const sessionNumberSchema = z.enum(["SESSION_1", "SESSION_2"]);
const initiatedBySchema = z.enum(["STUDENT", "COUNSELLOR", "ADMIN"]);
const joinRoleSchema = z.enum(["STUDENT", "COUNSELLOR"]);
const cancellationReasonSchema = z.enum([
  "STUDENT_UNAVAILABLE",
  "COUNSELLOR_UNAVAILABLE",
  "INSTITUTION_REQUEST",
  "OTHER",
]);

export const sessionIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const studentIdParamsSchema = z.object({
  studentId: z.string().cuid(),
});

export const counsellorIdParamsSchema = z.object({
  counsellorId: z.string().cuid(),
});

// --- Slot import (one-time, per project, at project creation) ---

export const importSlotsBodySchema = z.object({
  projectId: z.string().cuid(),
  slots: z
    .array(
      z.object({
        counsellorId: z.string().cuid(),
        date: dateSchema,
        startTime: timeSchema,
        endTime: timeSchema,
      })
    )
    .min(1),
});
export type ImportSlotsBody = z.infer<typeof importSlotsBodySchema>;

// --- Slot add / delete (Admin, after the initial import) ---
// The one-time import above is the project's opening inventory. These exist for the
// case the import can't cover: a counsellor assigned to a project *after* it went
// live (POST /counsellors/:id/projects) has no slots at all and would otherwise be
// unbookable. Scoped to one counsellor at a time so an "add availability" screen maps
// straight onto it.

export const addSlotsBodySchema = z.object({
  projectId: z.string().cuid(),
  counsellorId: z.string().cuid(),
  slots: z
    .array(
      z.object({
        date: dateSchema,
        startTime: timeSchema,
        endTime: timeSchema,
      })
    )
    .min(1),
});
export type AddSlotsBody = z.infer<typeof addSlotsBodySchema>;

export const slotIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listSlotsQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  counsellorId: z.string().cuid().optional(),
  status: z.enum(["OPEN", "BOOKED"]).optional(),
});
export type ListSlotsQuery = z.infer<typeof listSlotsQuerySchema>;

// --- Booking ---

export const bookingOptionsQuerySchema = z.object({
  sessionNumber: sessionNumberSchema,
  // Required (and only meaningful) when sessionNumber is SESSION_2 — the Session 1
  // pick the student is previewing Session 2 slots against.
  session1Date: dateSchema.optional(),
  session1StartTime: timeSchema.optional(),
});
export type BookingOptionsQuery = z.infer<typeof bookingOptionsQuerySchema>;

export const bookSessionsBodySchema = z.object({
  session1: z.object({ date: dateSchema, startTime: timeSchema }),
  session2: z.object({ date: dateSchema, startTime: timeSchema }),
});
export type BookSessionsBody = z.infer<typeof bookSessionsBodySchema>;

// --- Admin manual creation ---

export const createSessionBodySchema = z.object({
  studentId: z.string().cuid(),
  counsellorId: z.string().cuid(),
  sessionNumber: sessionNumberSchema,
  date: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
});
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

// --- Listing ---

export const listSessionsQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  instituteId: z.string().cuid().optional(),
  studentId: z.string().cuid().optional(),
  counsellorId: z.string().cuid().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "RESCHEDULED", "CANCELLED"]).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  // Oversight filter for the no-show operational metric (docs/Session Handling_
  // Cancellation  Rescheduling.pdf §4 — "tracked as an operational metric, feeding back
  // into the monthly availability review"). `STUDENT`/`COUNSELLOR` filters to sessions
  // where that party's no-show flag is set; combine with counsellorId/from/to for a
  // per-counsellor monthly count.
  noShow: z.enum(["STUDENT", "COUNSELLOR"]).optional(),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

export const counsellorSessionsQuerySchema = z.object({
  status: z.enum(["SCHEDULED", "COMPLETED", "RESCHEDULED", "CANCELLED"]).optional(),
});
export type CounsellorSessionsQuery = z.infer<typeof counsellorSessionsQuerySchema>;

export const counsellorMyStudentsQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  workflowStatus: workflowStatusSchema.optional(),
});
export type CounsellorMyStudentsQuery = z.infer<typeof counsellorMyStudentsQuerySchema>;

// --- Join / complete / notes ---
// No per-session meeting-link schema — each session's link is always its counsellor's
// (Counsellor.meetingLink), resolved server-side, not set per session.

export const joinSessionBodySchema = z.object({
  role: joinRoleSchema,
});
export type JoinSessionBody = z.infer<typeof joinSessionBodySchema>;

export const setNotesBodySchema = z.object({
  notes: z.string().trim().min(1),
});
export type SetNotesBody = z.infer<typeof setNotesBodySchema>;

// --- Reschedule / cancel ---

export const rescheduleSessionBodySchema = z.object({
  date: dateSchema,
  startTime: timeSchema,
  initiatedBy: initiatedBySchema,
});
export type RescheduleSessionBody = z.infer<typeof rescheduleSessionBodySchema>;

export const cancelSessionBodySchema = z.object({
  reason: cancellationReasonSchema,
  notes: z.string().trim().min(1).optional(),
  initiatedBy: initiatedBySchema,
});
export type CancelSessionBody = z.infer<typeof cancelSessionBodySchema>;

// --- Counsellor-initiated reschedule ---

export const requestCounsellorRescheduleBodySchema = z.object({
  reason: z.string().trim().min(1),
  date: dateSchema,
  startTime: timeSchema,
});
export type RequestCounsellorRescheduleBody = z.infer<typeof requestCounsellorRescheduleBodySchema>;

// --- No-show tracking ---

export const markNoShowBodySchema = z.object({
  party: z.enum(["STUDENT", "COUNSELLOR"]),
});
export type MarkNoShowBody = z.infer<typeof markNoShowBodySchema>;

// --- Reminder trigger (manual — no scheduler/cron exists yet, see email module README) ---

export const sendDayReminderBodySchema = z.object({
  portalLink: z.string().trim().url().optional(),
});
export type SendDayReminderBody = z.infer<typeof sendDayReminderBodySchema>;
