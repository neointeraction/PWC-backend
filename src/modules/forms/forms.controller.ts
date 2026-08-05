import type { Request, Response } from "express";
import * as formsService from "./forms.service.js";
import type {
  FormStudentParams,
  FormTypeParams,
  GetFormTemplateQuery,
  SaveFormAnswersBody,
} from "./forms.schema.js";

export async function getFormTemplate(req: Request, res: Response): Promise<void> {
  const { formType } = req.params as unknown as FormTypeParams;
  const query = req.query as unknown as GetFormTemplateQuery;
  const template = await formsService.getFormTemplate(formType, query);
  res.status(200).json(template);
}

export async function saveFormDraft(req: Request, res: Response): Promise<void> {
  const { formType, studentId } = req.params as unknown as FormStudentParams;
  const body = req.body as SaveFormAnswersBody;
  const submission = await formsService.saveFormAnswers(formType, studentId, body, {
    finalize: false,
  });
  res.status(200).json(submission);
}

export async function submitForm(req: Request, res: Response): Promise<void> {
  const { formType, studentId } = req.params as unknown as FormStudentParams;
  const body = req.body as SaveFormAnswersBody;
  const submission = await formsService.saveFormAnswers(formType, studentId, body, {
    finalize: true,
  });
  res.status(200).json(submission);
}

export async function getFormSubmission(req: Request, res: Response): Promise<void> {
  const { formType, studentId } = req.params as unknown as FormStudentParams;
  const query = req.query as unknown as GetFormTemplateQuery;
  const submission = await formsService.getFormSubmission(
    formType,
    studentId,
    query.cohort,
    query.version
  );
  res.status(200).json(submission);
}
