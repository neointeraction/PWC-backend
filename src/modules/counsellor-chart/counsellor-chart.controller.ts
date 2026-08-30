import type { Request, Response } from "express";
import * as service from "./counsellor-chart.service.js";
import * as assessmentService from "../assessment/assessment.service.js";
import type {
  AmendmentBody,
  AmendmentParams,
  FinalizeCounsellorChartBody,
  PutCounsellorChartBody,
  StudentIdParams,
} from "./counsellor-chart.schema.js";

export async function getCounsellorChart(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as StudentIdParams;
  const chart = await service.getCounsellorChart(studentId);
  res.status(200).json(chart);
}

export async function updateCounsellorChart(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as StudentIdParams;
  const body = req.body as PutCounsellorChartBody;
  const chart = await service.updateCounsellorChart(studentId, body);
  res.status(200).json(chart);
}

export async function finalizeCounsellorChart(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as StudentIdParams;
  const { finalizedBy } = (req.body ?? {}) as FinalizeCounsellorChartBody;
  const chart = await service.finalizeCounsellorChart(studentId, finalizedBy);
  res.status(200).json(chart);
}

export async function applyMirrorPairAmendment(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as unknown as StudentIdParams;
  const { questionCode, amendedOption, counsellorId } = req.body as AmendmentBody;
  const result = await assessmentService.applyMirrorPairAmendment(
    studentId,
    questionCode,
    amendedOption,
    counsellorId
  );
  res.status(200).json(result);
}

export async function revertMirrorPairAmendment(req: Request, res: Response): Promise<void> {
  const { studentId, questionCode } = req.params as unknown as AmendmentParams;
  const result = await assessmentService.revertMirrorPairAmendment(studentId, questionCode);
  res.status(200).json(result);
}
