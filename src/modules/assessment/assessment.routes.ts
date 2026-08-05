import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as assessmentController from "./assessment.controller.js";
import { listAssessmentQuestionsQuerySchema } from "./assessment.schema.js";

export const assessmentRouter = Router();

assessmentRouter.get(
  "/questions",
  validate({ query: listAssessmentQuestionsQuerySchema }),
  asyncHandler(assessmentController.listAssessmentQuestions)
);
