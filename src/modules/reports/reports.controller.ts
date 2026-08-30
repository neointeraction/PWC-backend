import type { Request, Response } from "express";
import * as reportsService from "./reports.service.js";
import type { ReportStudentParams } from "./reports.schema.js";

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
