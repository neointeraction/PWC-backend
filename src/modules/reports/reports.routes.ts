import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStudentOrStaff, requireStudent } from "../../common/middlewares/auth.js";
import { ownStudentParam } from "../../common/middlewares/ownership.js";
import * as reportsController from "./reports.controller.js";
import { reportStudentParamsSchema } from "./reports.schema.js";

export const reportsRouter = Router();

// The student assessment report — the student sees their own (student-facing deliverable),
// staff see any. 404 until the student has a computed assessment result.
reportsRouter.get(
  "/students/:studentId/assessment",
  ...requireStudentOrStaff,
  validate({ params: reportStudentParamsSchema }),
  ownStudentParam,
  asyncHandler(reportsController.getStudentAssessmentReport)
);

// The student accepts the finalized report — the counsellor's signal that the student has
// actually seen and confirmed it, so this is deliberately student-only, no staff bypass
// (unlike most self-service endpoints): accepting now also locks the counsellor chart from
// further edits (see updateCounsellorChart), so a staff member clicking this on their own
// preview must never be able to trigger it. 404 if no assessment result yet, 400 if the
// chart isn't finalized yet. Idempotent. Backed by the same CounsellorChart.acceptedAt as
// the counsellor-chart module's own /accept endpoint (see reports.service.ts).
reportsRouter.post(
  "/students/:studentId/accept",
  ...requireStudent,
  validate({ params: reportStudentParamsSchema }),
  ownStudentParam,
  asyncHandler(reportsController.acceptStudentReport)
);
