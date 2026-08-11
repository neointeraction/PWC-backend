import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
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
sessionsRouter.post("/slots/import", validate({ body: importSlotsBodySchema }), asyncHandler(sessionsController.importSlots));
sessionsRouter.get("/slots", validate({ query: listSlotsQuerySchema }), asyncHandler(sessionsController.listSlots));

// Booking (Student)
sessionsRouter.get(
  "/students/:studentId/booking-options",
  validate({ params: studentIdParamsSchema, query: bookingOptionsQuerySchema }),
  asyncHandler(sessionsController.getBookingOptions)
);
sessionsRouter.post(
  "/students/:studentId/book",
  validate({ params: studentIdParamsSchema, body: bookSessionsBodySchema }),
  asyncHandler(sessionsController.bookSessions)
);
sessionsRouter.get(
  "/students/:studentId",
  validate({ params: studentIdParamsSchema }),
  asyncHandler(sessionsController.getStudentSessions)
);

// Dashboard (Counsellor)
sessionsRouter.get(
  "/counsellors/:counsellorId",
  validate({ params: counsellorIdParamsSchema, query: counsellorSessionsQuerySchema }),
  asyncHandler(sessionsController.getCounsellorSessions)
);
sessionsRouter.get(
  "/counsellors/:counsellorId/my-students",
  validate({ params: counsellorIdParamsSchema, query: counsellorMyStudentsQuerySchema }),
  asyncHandler(sessionsController.getCounsellorMyStudents)
);

// Admin oversight + manual creation
sessionsRouter.post("/", validate({ body: createSessionBodySchema }), asyncHandler(sessionsController.createSession));
sessionsRouter.get("/", validate({ query: listSessionsQuerySchema }), asyncHandler(sessionsController.listSessions));
sessionsRouter.get("/:id", validate({ params: sessionIdParamsSchema }), asyncHandler(sessionsController.getSession));

// Meeting link / join / complete / notes
sessionsRouter.patch(
  "/:id/meeting-link",
  validate({ params: sessionIdParamsSchema, body: setMeetingLinkBodySchema }),
  asyncHandler(sessionsController.setMeetingLink)
);
sessionsRouter.post(
  "/:id/join",
  validate({ params: sessionIdParamsSchema, body: joinSessionBodySchema }),
  asyncHandler(sessionsController.joinSession)
);
sessionsRouter.post(
  "/:id/complete",
  validate({ params: sessionIdParamsSchema }),
  asyncHandler(sessionsController.completeSession)
);
sessionsRouter.patch(
  "/:id/notes",
  validate({ params: sessionIdParamsSchema, body: setNotesBodySchema }),
  asyncHandler(sessionsController.setNotes)
);

// Reschedule / cancel
sessionsRouter.post(
  "/:id/reschedule",
  validate({ params: sessionIdParamsSchema, body: rescheduleSessionBodySchema }),
  asyncHandler(sessionsController.rescheduleSession)
);
sessionsRouter.post(
  "/:id/cancel",
  validate({ params: sessionIdParamsSchema, body: cancelSessionBodySchema }),
  asyncHandler(sessionsController.cancelSession)
);

// Day-of reminder (manual trigger — no scheduler exists yet)
sessionsRouter.post(
  "/:id/send-day-reminder",
  validate({ params: sessionIdParamsSchema, body: sendDayReminderBodySchema }),
  asyncHandler(sessionsController.sendDayReminder)
);
