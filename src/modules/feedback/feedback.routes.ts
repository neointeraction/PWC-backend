import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as controller from "./feedback.controller.js";
import { counsellorIdParamsSchema, studentIdParamsSchema } from "./feedback.schema.js";

export const feedbackRouter = Router();

// Counsellor Satisfaction Final Score % for one student (both feedback forms required).
// Returns { complete: false, missingForms } when the pair is incomplete.
feedbackRouter.get(
  "/students/:studentId/score",
  validate({ params: studentIdParamsSchema }),
  asyncHandler(controller.getStudentFeedbackScore)
);

// A counsellor's Overall Score % — the average of their students' complete-pair Final
// Score %s, mapped to a Performance Band and incentive.
feedbackRouter.get(
  "/counsellors/:counsellorId/score",
  validate({ params: counsellorIdParamsSchema }),
  asyncHandler(controller.getCounsellorFeedbackScore)
);
