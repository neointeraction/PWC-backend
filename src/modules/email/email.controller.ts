import type { Request, Response } from "express";
import * as emailService from "./email.service.js";
import type { SendTemplateEmailBody } from "./email.schema.js";

export async function listTemplates(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ templateKeys: emailService.listEmailTemplateKeys() });
}

export async function sendTemplateEmail(req: Request, res: Response): Promise<void> {
  const { to, templateKey, data } = req.body as SendTemplateEmailBody;
  const result = await emailService.sendTemplateEmail(to, templateKey, data);
  res.status(202).json(result);
}
