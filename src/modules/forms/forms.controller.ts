import type { Request, Response } from "express";
import * as formsService from "./forms.service.js";
import type { FormTypeParams, GetFormTemplateQuery } from "./forms.schema.js";

export async function getFormTemplate(req: Request, res: Response): Promise<void> {
  const { formType } = req.params as unknown as FormTypeParams;
  const query = req.query as unknown as GetFormTemplateQuery;
  const template = await formsService.getFormTemplate(formType, query);
  res.status(200).json(template);
}
