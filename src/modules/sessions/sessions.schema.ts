import { z } from "zod";
import { workflowStatusSchema } from "../students/students.schema.js";

// "HH:mm", 24h — matches CounsellorSlot/Session.startTime/endTime.
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm 24h format");
// "YYYY-MM-DD" — matches the @db.Date columns.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

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

// --- Meeting link / join / complete / notes ---

export const setMeetingLinkBodySchema = z.object({
  meetingLink: z.string().trim().url(),
});
export type SetMeetingLinkBody = z.infer<typeof setMeetingLinkBodySchema>;

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

// --- Reminder trigger (manual — no scheduler/cron exists yet, see email module README) ---

export const sendDayReminderBodySchema = z.object({
  portalLink: z.string().trim().url().optional(),
});
export type SendDayReminderBody = z.infer<typeof sendDayReminderBodySchema>;
