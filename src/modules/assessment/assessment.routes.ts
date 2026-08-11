import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireAuth, requireStaff, requireStudentOrStaff } from "../../common/middlewares/auth.js";
import { ownAttemptParam, ownStudentBody } from "../../common/middlewares/ownership.js";
import * as assessmentController from "./assessment.controller.js";
import {
  attemptIdParamsSchema,
  listAssessmentQuestionsQuerySchema,
  previewScoreBodySchema,
  saveAssessmentAnswersBodySchema,
  startAttemptBodySchema,
} from "./assessment.schema.js";

export const assessmentRouter = Router();

// Question bank is non-sensitive (no answer key exposed) — any authenticated user.
assessmentRouter.get(
  "/questions",
  ...requireAuth,
  validate({ query: listAssessmentQuestionsQuerySchema }),
  asyncHandler(assessmentController.listAssessmentQuestions)
);

// Dev/QA score preview — staff-only. Runs the scoring engine over ad-hoc answers with no
// student/attempt/persistence, so the assessment logic can be inspected in isolation.
assessmentRouter.post(
  "/score-preview",
  ...requireStaff,
  validate({ body: previewScoreBodySchema }),
  asyncHandler(assessmentController.previewScore)
);

// Attempt flow is student self-service (or staff acting on their behalf).
// Starts a new attempt, or resumes the student's existing in-progress one for this cohort.
assessmentRouter.post(
  "/attempts",
  ...requireStudentOrStaff,
  validate({ body: startAttemptBodySchema }),
  ownStudentBody,
  asyncHandler(assessmentController.startAttempt)
);

assessmentRouter.get(
  "/attempts/:attemptId",
  ...requireStudentOrStaff,
  validate({ params: attemptIdParamsSchema }),
  ownAttemptParam,
  asyncHandler(assessmentController.getAttempt)
);

// Save/update answers ("Save Progress" on the source form). Idempotent — can be
// called repeatedly until the attempt is submitted.
assessmentRouter.put(
  "/attempts/:attemptId/answers",
  ...requireStudentOrStaff,
  validate({ params: attemptIdParamsSchema, body: saveAssessmentAnswersBodySchema }),
  ownAttemptParam,
  asyncHandler(assessmentController.saveAssessmentAnswers)
);

// Finalize: validates every question in the cohort has an answer, locks the attempt,
// then computes and stores the AssessmentResult (scoring engine).
assessmentRouter.post(
  "/attempts/:attemptId/submit",
  ...requireStudentOrStaff,
  validate({ params: attemptIdParamsSchema }),
  ownAttemptParam,
  asyncHandler(assessmentController.submitAttempt)
);

// Computed scoring report for a submitted attempt (trait scores + grades, DCS/DPS,
// Stream Fit, reliability dashboard). 404 until the attempt is submitted.
assessmentRouter.get(
  "/attempts/:attemptId/result",
  ...requireStudentOrStaff,
  validate({ params: attemptIdParamsSchema }),
  ownAttemptParam,
  asyncHandler(assessmentController.getAssessmentResult)
);
