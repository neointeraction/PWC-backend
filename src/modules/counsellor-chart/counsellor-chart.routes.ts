import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireStudent, requireSuperAdmin } from "../../common/middlewares/auth.js";
import { ownStudentParam } from "../../common/middlewares/ownership.js";
import { authenticateReportRead } from "../../common/middlewares/reportPdfAuth.js";
import * as controller from "./counsellor-chart.controller.js";
import {
  amendmentBodySchema,
  amendmentParamsSchema,
  finalizeCounsellorChartBodySchema,
  manualEntryIdParamsSchema,
  putCounsellorChartBodySchema,
  studentIdParamsSchema,
} from "./counsellor-chart.schema.js";

export const counsellorChartRouter = Router();

// Super Admin review queue: every free-text ("Manual Entry") row a counsellor has added
// across all 6 Career Direction tables, across all students. Flat list, no pagination.
counsellorChartRouter.get(
  "/manual-entries",
  ...requireSuperAdmin,
  asyncHandler(controller.listManualEntries)
);

// Super Admin "Close" action on a manual-entry review row: removes that one row from
// whichever student's chart and table array holds it. 404 if the id isn't found in any
// student's arrays (already deleted, or a bad id).
counsellorChartRouter.delete(
  "/manual-entries/:id",
  ...requireSuperAdmin,
  validate({ params: manualEntryIdParamsSchema }),
  asyncHandler(controller.deleteManualEntry)
);

// Assemble the full chart for a student (profile + both pre-counselling questionnaires
// side-by-side + assessment result + flagged mirror pairs + saved counsellor content).
// Lazily creates an empty chart row if none exists. Staff can read any student's chart;
// a student can only read their own (ownStudentParam) — it's all their own data (their
// profile, their assessment, their own flagged answer pairs, their counsellor's notes),
// already returned to them in full by POST /accept, so this just makes the same read
// available before acceptance too. The backend's own headless report-PDF render can also
// read it, via a report-pdf token instead of a login (see reportPdfAuth.ts).
counsellorChartRouter.get(
  "/students/:studentId",
  validate({ params: studentIdParamsSchema }),
  authenticateReportRead,
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
// Admin's pending queue and — same field as POST /reports/students/:id/accept — locks the
// chart from further counsellor edits (see updateCounsellorChart). Deliberately student-only,
// no staff bypass, unlike most student self-service endpoints: accepting must be the real
// student's own signal, not something a counsellor can trigger on their own preview.
// 400 if the chart isn't finalized yet.
counsellorChartRouter.post(
  "/students/:studentId/accept",
  ...requireStudent,
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
