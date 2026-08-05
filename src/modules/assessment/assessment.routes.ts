import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as assessmentController from "./assessment.controller.js";
import {
  attemptIdParamsSchema,
  listAssessmentQuestionsQuerySchema,
  saveAssessmentAnswersBodySchema,
  startAttemptBodySchema,
} from "./assessment.schema.js";

export const assessmentRouter = Router();

assessmentRouter.get(
  "/questions",
  validate({ query: listAssessmentQuestionsQuerySchema }),
  asyncHandler(assessmentController.listAssessmentQuestions)
);

// Starts a new attempt, or resumes the student's existing in-progress one for this cohort.
assessmentRouter.post(
  "/attempts",
  validate({ body: startAttemptBodySchema }),
  asyncHandler(assessmentController.startAttempt)
);

assessmentRouter.get(
  "/attempts/:attemptId",
  validate({ params: attemptIdParamsSchema }),
  asyncHandler(assessmentController.getAttempt)
);

// Save/update answers ("Save Progress" on the source form). Idempotent — can be
// called repeatedly until the attempt is submitted.
assessmentRouter.put(
  "/attempts/:attemptId/answers",
  validate({ params: attemptIdParamsSchema, body: saveAssessmentAnswersBodySchema }),
  asyncHandler(assessmentController.saveAssessmentAnswers)
);

// Finalize: validates every question in the cohort has an answer, then locks the attempt.
assessmentRouter.post(
  "/attempts/:attemptId/submit",
  validate({ params: attemptIdParamsSchema }),
  asyncHandler(assessmentController.submitAttempt)
);
