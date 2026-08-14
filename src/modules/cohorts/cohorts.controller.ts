import type { Request, Response } from "express";
import * as cohortsService from "./cohorts.service.js";

export async function listCohorts(_req: Request, res: Response): Promise<void> {
  const cohorts = await cohortsService.listCohorts();
  res.status(200).json(cohorts);
}
