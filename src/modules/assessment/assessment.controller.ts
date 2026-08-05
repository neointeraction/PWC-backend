import type { Request, Response } from "express";
import * as assessmentService from "./assessment.service.js";
import type {
  AttemptIdParams,
  ListAssessmentQuestionsQuery,
  SaveAssessmentAnswersBody,
  StartAttemptBody,
} from "./assessment.schema.js";

export async function listAssessmentQuestions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListAssessmentQuestionsQuery;
  const questions = await assessmentService.listAssessmentQuestions(query);
  res.status(200).json(questions);
}

export async function startAttempt(req: Request, res: Response): Promise<void> {
  const body = req.body as StartAttemptBody;
  // 200, not 201 — this may resume an existing in-progress attempt rather than create one.
  const attempt = await assessmentService.startOrResumeAttempt(body);
  res.status(200).json(attempt);
}

export async function saveAssessmentAnswers(req: Request, res: Response): Promise<void> {
  const { attemptId } = req.params as unknown as AttemptIdParams;
  const body = req.body as SaveAssessmentAnswersBody;
  const attempt = await assessmentService.saveAssessmentAnswers(attemptId, body);
  res.status(200).json(attempt);
}

export async function submitAttempt(req: Request, res: Response): Promise<void> {
  const { attemptId } = req.params as unknown as AttemptIdParams;
  const attempt = await assessmentService.submitAttempt(attemptId);
  res.status(200).json(attempt);
}

export async function getAttempt(req: Request, res: Response): Promise<void> {
  const { attemptId } = req.params as unknown as AttemptIdParams;
  const attempt = await assessmentService.getAttempt(attemptId);
  res.status(200).json(attempt);
}
