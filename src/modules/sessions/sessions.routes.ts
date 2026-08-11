import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin, requireStudentOrStaff } from "../../common/middlewares/auth.js";
import { ownSessionParam, ownStudentParam } from "../../common/middlewares/ownership.js";
import * as sessionsController from "./sessions.controller.js";
import {
  bookSessionsBodySchema,
  bookingOptionsQuerySchema,
  cancelSessionBodySchema,
  counsellorIdParamsSchema,
  counsellorMyStudentsQuerySchema,
  counsellorSessionsQuerySchema,
  createSessionBodySchema,
  importSlotsBodySchema,
  joinSessionBodySchema,
  listSessionsQuerySchema,
  listSlotsQuerySchema,
  rescheduleSessionBodySchema,
  sendDayReminderBodySchema,
  sessionIdParamsSchema,
  setMeetingLinkBodySchema,
  setNotesBodySchema,
  studentIdParamsSchema,
} from "./sessions.schema.js";

export const sessionsRouter = Router();

// Slot inventory (Admin, at project creation — one-time import)
sessionsRouter.post("/slots/import", ...requireAdmin, validate({ body: importSlotsBodySchema }), asyncHandler(sessionsController.importSlots));
sessionsRouter.get("/slots", ...requireStaff, validate({ query: listSlotsQuerySchema }), asyncHandler(sessionsController.listSlots));

// Booking (Student self-service, or staff on their behalf)
sessionsRouter.get(
  "/students/:studentId/booking-options",
  ...requireStudentOrStaff,
  validate({ params: studentIdParamsSchema, query: bookingOptionsQuerySchema }),
  ownStudentParam,
  asyncHandler(sessionsController.getBookingOptions)
);
sessionsRouter.post(
  "/students/:studentId/book",
  ...requireStudentOrStaff,
  validate({ params: studentIdParamsSchema, body: bookSessionsBodySchema }),
  ownStudentParam,
  asyncHandler(sessionsController.bookSessions)
);
sessionsRouter.get(
  "/students/:studentId",
  ...requireStudentOrStaff,
  validate({ params: studentIdParamsSchema }),
  ownStudentParam,
  asyncHandler(sessionsController.getStudentSessions)
);

// Dashboard (Counsellor / Admin)
sessionsRouter.get(
  "/counsellors/:counsellorId",
  ...requireStaff,
  validate({ params: counsellorIdParamsSchema, query: counsellorSessionsQuerySchema }),
  asyncHandler(sessionsController.getCounsellorSessions)
);
sessionsRouter.get(
  "/counsellors/:counsellorId/my-students",
  ...requireStaff,
  validate({ params: counsellorIdParamsSchema, query: counsellorMyStudentsQuerySchema }),
  asyncHandler(sessionsController.getCounsellorMyStudents)
);

// Manual creation = admin; oversight lists/detail = staff
sessionsRouter.post("/", ...requireAdmin, validate({ body: createSessionBodySchema }), asyncHandler(sessionsController.createSession));
sessionsRouter.get("/", ...requireStaff, validate({ query: listSessionsQuerySchema }), asyncHandler(sessionsController.listSessions));
sessionsRouter.get("/:id", ...requireStaff, validate({ params: sessionIdParamsSchema }), asyncHandler(sessionsController.getSession));

// Meeting link / join / complete / notes. Join is student- or staff-initiated; the rest
// are counsellor/admin actions.
sessionsRouter.patch(
  "/:id/meeting-link",
  ...requireStaff,
  validate({ params: sessionIdParamsSchema, body: setMeetingLinkBodySchema }),
  asyncHandler(sessionsController.setMeetingLink)
);
sessionsRouter.post(
  "/:id/join",
  ...requireStudentOrStaff,
  validate({ params: sessionIdParamsSchema, body: joinSessionBodySchema }),
  ownSessionParam,
  asyncHandler(sessionsController.joinSession)
);
sessionsRouter.post(
  "/:id/complete",
  ...requireStaff,
  validate({ params: sessionIdParamsSchema }),
  asyncHandler(sessionsController.completeSession)
);
sessionsRouter.patch(
  "/:id/notes",
  ...requireStaff,
  validate({ params: sessionIdParamsSchema, body: setNotesBodySchema }),
  asyncHandler(sessionsController.setNotes)
);

// Reschedule / cancel — student self-service or staff
sessionsRouter.post(
  "/:id/reschedule",
  ...requireStudentOrStaff,
  validate({ params: sessionIdParamsSchema, body: rescheduleSessionBodySchema }),
  ownSessionParam,
  asyncHandler(sessionsController.rescheduleSession)
);
sessionsRouter.post(
  "/:id/cancel",
  ...requireStudentOrStaff,
  validate({ params: sessionIdParamsSchema, body: cancelSessionBodySchema }),
  ownSessionParam,
  asyncHandler(sessionsController.cancelSession)
);

// Day-of reminder (manual trigger — no scheduler exists yet)
sessionsRouter.post(
  "/:id/send-day-reminder",
  ...requireStaff,
  validate({ params: sessionIdParamsSchema, body: sendDayReminderBodySchema }),
  asyncHandler(sessionsController.sendDayReminder)
);
