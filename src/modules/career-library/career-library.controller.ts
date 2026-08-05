import type { Request, Response } from "express";
import * as careerLibraryService from "./career-library.service.js";
import type { CareerLibraryIdParams, ListCareerLibraryQuery } from "./career-library.schema.js";

export async function listCareerLibraryEntries(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCareerLibraryQuery;
  const result = await careerLibraryService.listCareerLibraryEntries(query);
  res.status(200).json(result);
}

export async function getCareerLibraryFilters(_req: Request, res: Response): Promise<void> {
  const filters = await careerLibraryService.getCareerLibraryFilters();
  res.status(200).json(filters);
}

export async function getCareerLibraryEntry(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CareerLibraryIdParams;
  const entry = await careerLibraryService.getCareerLibraryEntryById(id);
  res.status(200).json(entry);
}
