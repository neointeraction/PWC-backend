import type { Request, Response } from "express";
import * as assessmentService from "./assessment.service.js";
import type { ListAssessmentQuestionsQuery } from "./assessment.schema.js";

export async function listAssessmentQuestions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListAssessmentQuestionsQuery;
  const questions = await assessmentService.listAssessmentQuestions(query);
  res.status(200).json(questions);
}
