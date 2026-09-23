import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { authenticateStaticReadForReportPdf } from "../../common/middlewares/reportPdfAuth.js";
import * as scriBandGuidanceController from "./scri-band-guidance.controller.js";

export const scriBandGuidanceRouter = Router();

// Static reference data (4 rows, one per SCRI band) — any logged-in role, no
// per-record ownership to guard. Frontend independently computes band/label from a
// student's SCRI total; this just supplies the guidance text (see
// src/modules/counsellor-chart/scri.ts). The backend's own headless report-PDF render
// also needs this (My kREATE Blueprint page) and has no login, so a report-pdf token
// unlocks it too — see reportPdfAuth.ts.
scriBandGuidanceRouter.get(
  "/",
  authenticateStaticReadForReportPdf,
  asyncHandler(scriBandGuidanceController.listScriBandGuidance)
);
