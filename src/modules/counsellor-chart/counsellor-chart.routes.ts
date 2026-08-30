import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff } from "../../common/middlewares/auth.js";
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
// Lazily creates an empty chart row if none exists.
counsellorChartRouter.get(
  "/students/:studentId",
  ...requireStaff,
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
