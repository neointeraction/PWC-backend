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
