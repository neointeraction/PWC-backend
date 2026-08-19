import type { Request, Response } from "express";
import * as languagesService from "./languages.service.js";

export async function listLanguages(_req: Request, res: Response): Promise<void> {
  const languages = await languagesService.listLanguages();
  res.status(200).json(languages);
}
