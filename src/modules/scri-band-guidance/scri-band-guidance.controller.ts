import type { Request, Response } from "express";
import * as scriBandGuidanceService from "./scri-band-guidance.service.js";

export async function listScriBandGuidance(_req: Request, res: Response): Promise<void> {
  const data = await scriBandGuidanceService.listScriBandGuidance();
  res.status(200).json({ data });
}
