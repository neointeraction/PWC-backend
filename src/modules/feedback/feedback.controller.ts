import type { Request, Response } from "express";
import * as service from "./feedback.service.js";
import type { CounsellorIdParams, StudentIdParams } from "./feedback.schema.js";

export async function getStudentFeedbackScore(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as StudentIdParams;
  const result = await service.getStudentFeedbackScore(studentId);
  res.status(200).json(result);
}

export async function getCounsellorFeedbackScore(req: Request, res: Response): Promise<void> {
  const { counsellorId } = req.params as unknown as CounsellorIdParams;
  const result = await service.getCounsellorFeedbackScore(counsellorId);
  res.status(200).json(result);
}
