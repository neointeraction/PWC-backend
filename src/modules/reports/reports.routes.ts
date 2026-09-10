import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStudentOrStaff } from "../../common/middlewares/auth.js";
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

// Student/parent accepts the finalized report — signals the counsellor that it's been
// seen and confirmed. 404 if no assessment result yet, 400 if the chart isn't finalized
// yet. Idempotent. Backed by the same CounsellorChart.acceptedAt as the counsellor-chart
// module's own /accept endpoint (see reports.service.ts).
reportsRouter.post(
  "/students/:studentId/accept",
  ...requireStudentOrStaff,
  validate({ params: reportStudentParamsSchema }),
  ownStudentParam,
  asyncHandler(reportsController.acceptStudentReport)
);
