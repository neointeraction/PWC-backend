import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireStudentOrStaff } from "../../common/middlewares/auth.js";
import { ownStudentParam } from "../../common/middlewares/ownership.js";
import * as controller from "./counsellor-chart.controller.js";
import {
  amendmentBodySchema,
  amendmentParamsSchema,
  finalizeCounsellorChartBodySchema,
  putCounsellorChartBodySchema,
  studentIdParamsSchema,
} from "./counsellor-chart.schema.js";

export const counsellorChartRouter = Router();

// Assemble the full chart for a student (profile + both pre-counselling questionnaires
// side-by-side + assessment result + flagged mirror pairs + saved counsellor content).
// Lazily creates an empty chart row if none exists. Staff can read any student's chart;
// a student can only read their own (ownStudentParam) — it's all their own data (their
// profile, their assessment, their own flagged answer pairs, their counsellor's notes),
// already returned to them in full by POST /accept, so this just makes the same read
// available before acceptance too.
counsellorChartRouter.get(
  "/students/:studentId",
  ...requireStudentOrStaff,
  ownStudentParam,
  validate({ params: studentIdParamsSchema }),
  asyncHandler(controller.getCounsellorChart)
);

// Partial save of counsellor-authored content: synthesis notes, SCRI ratings, academic
// trend, alignment rating, strengths/hobbies/career shortlist. Recomputes the SCRI band.
counsellorChartRouter.put(
  "/students/:studentId",
  ...requireStaff,
  validate({ params: studentIdParamsSchema, body: putCounsellorChartBodySchema }),
  asyncHandler(controller.updateCounsellorChart)
);

// Finalize the chart — stamps `finalizedAt` and advances the student's workflow to
// COUNSELLOR_FEEDBACK. Idempotent; 400 if the chart has no counsellor content yet.
counsellorChartRouter.post(
  "/students/:studentId/finalize",
  ...requireStaff,
  validate({ params: studentIdParamsSchema, body: finalizeCounsellorChartBodySchema }),
  asyncHandler(controller.finalizeCounsellorChart)
);

// Student accept: the logged-in student acknowledges their own finalized chart. Stamps
// `acceptedAt`, which gates this chart's career-library job-role proposals into the Super
// Admin's pending queue. Staff may also call it (ownership check bypasses for staff roles,
// same as every other student self-service endpoint). 400 if the chart isn't finalized yet.
counsellorChartRouter.post(
  "/students/:studentId/accept",
  ...requireStudentOrStaff,
  ownStudentParam,
  validate({ params: studentIdParamsSchema }),
  asyncHandler(controller.acceptCounsellorChart)
);

// Amend a flagged mirror-pair answer — overrides the student's response (original kept)
// and re-scores the whole assessment. Returns the recomputed AssessmentResult.
counsellorChartRouter.post(
  "/students/:studentId/mirror-pair-amendments",
  ...requireStaff,
  validate({ params: studentIdParamsSchema, body: amendmentBodySchema }),
  asyncHandler(controller.applyMirrorPairAmendment)
);

// Revert an amendment back to the student's original answer, then re-score.
counsellorChartRouter.delete(
  "/students/:studentId/mirror-pair-amendments/:questionCode",
  ...requireStaff,
  validate({ params: amendmentParamsSchema }),
  asyncHandler(controller.revertMirrorPairAmendment)
);
