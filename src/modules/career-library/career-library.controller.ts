import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import * as careerLibraryService from "./career-library.service.js";
import type { Actor } from "./career-library.service.js";
import type {
  ApproveCareerRequestInput,
  CareerLibraryIdParams,
  CareerRequestIdParams,
  ListCareerLibraryQuery,
  ListCareerRequestsQuery,
} from "./career-library.schema.js";

function actorOf(req: Request): Actor {
  if (!req.user) throw new UnauthorizedError();
  return { userId: req.user.sub, role: req.user.role };
}

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

// --- Entry writes ---

export async function createCareerLibraryEntry(req: Request, res: Response): Promise<void> {
  const entry = await careerLibraryService.createCareerEntry(req.body, actorOf(req));
  res.status(201).json(entry);
}

export async function updateCareerLibraryEntry(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CareerLibraryIdParams;
  const entry = await careerLibraryService.updateCareerEntry(id, req.body, actorOf(req));
  res.status(200).json(entry);
}

export async function deleteCareerLibraryEntry(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CareerLibraryIdParams;
  await careerLibraryService.deleteCareerEntry(id);
  res.status(204).send();
}

// --- Ratification requests ---

export async function createCareerRequest(req: Request, res: Response): Promise<void> {
  const request = await careerLibraryService.createCareerRequest(req.body, actorOf(req));
  res.status(201).json(request);
}

export async function listCareerRequests(req: Request, res: Response): Promise<void> {
  const request = await careerLibraryService.listCareerRequests(req.query as unknown as ListCareerRequestsQuery);
  res.status(200).json(request);
}

export async function getCareerRequest(req: Request, res: Response): Promise<void> {
  const { requestId } = req.params as unknown as CareerRequestIdParams;
  const request = await careerLibraryService.getCareerRequestById(requestId);
  res.status(200).json(request);
}

export async function approveCareerRequest(req: Request, res: Response): Promise<void> {
  const { requestId } = req.params as unknown as CareerRequestIdParams;
  const request = await careerLibraryService.approveCareerRequest(
    requestId,
    req.body as ApproveCareerRequestInput,
    actorOf(req)
  );
  res.status(200).json(request);
}

export async function rejectCareerRequest(req: Request, res: Response): Promise<void> {
  const { requestId } = req.params as unknown as CareerRequestIdParams;
  const request = await careerLibraryService.rejectCareerRequest(requestId, actorOf(req));
  res.status(200).json(request);
}
