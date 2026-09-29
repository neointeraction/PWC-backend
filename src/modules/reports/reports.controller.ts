import type { Request, Response } from "express";
import * as reportsService from "./reports.service.js";
import type { ReportStudentParams } from "./reports.schema.js";
import { renderStudentReportPdf } from "./report-pdf.service.js";
import { sendPdfDownload, studentPdfFilename } from "../../common/utils/sendPdfDownload.js";

export async function getStudentAssessmentReport(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as ReportStudentParams;
  const report = await reportsService.assembleStudentAssessmentReport(studentId);
  // A student opening their own report closes the case (no-op for staff, and for a
  // student who isn't at the final stage yet).
  if (req.user?.role === "STUDENT") {
    await reportsService.markReportDeliveredToStudent(studentId);
  }
  res.status(200).json(report);
}

export async function acceptStudentReport(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as ReportStudentParams;
  const result = await reportsService.acceptStudentReport(studentId);
  res.status(200).json(result);
}

// Staff "Download Compass" from Project Students: the same kREATE Compass PDF the parent
// is emailed, streamed back as a file download. Assembling the report first gives a clean
// 404 when the student has no assessment result yet, instead of a failed render.
export async function downloadStudentReportPdf(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as ReportStudentParams;
  const filename = await studentPdfFilename(studentId, "kREATE Compass Report");
  await reportsService.assembleStudentAssessmentReport(studentId);
  const pdf = await renderStudentReportPdf(studentId);
  sendPdfDownload(res, filename, pdf);
}
