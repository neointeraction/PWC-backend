import type { Request, Response } from "express";
import * as reportsService from "./reports.service.js";
import type { ReportStudentParams } from "./reports.schema.js";

export async function getStudentAssessmentReport(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as ReportStudentParams;
  const report = await reportsService.assembleStudentAssessmentReport(studentId);
  res.status(200).json(report);
}
