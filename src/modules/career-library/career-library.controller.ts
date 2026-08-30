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
  ListCoursesQuery,
  ListEntranceExamsQuery,
  ListInstitutionsQuery,
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

// --- Dropdown / typeahead lookups ---

export async function listEntranceExams(req: Request, res: Response): Promise<void> {
  const rows = await careerLibraryService.listEntranceExams(req.query as unknown as ListEntranceExamsQuery);
  res.status(200).json(rows);
}

export async function listInstitutions(req: Request, res: Response): Promise<void> {
  const rows = await careerLibraryService.listInstitutions(req.query as unknown as ListInstitutionsQuery);
  res.status(200).json(rows);
}

export async function listCourses(req: Request, res: Response): Promise<void> {
  const rows = await careerLibraryService.listCourses(req.query as unknown as ListCoursesQuery);
  res.status(200).json(rows);
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

// --- Standalone reference-data submissions + review ---
// Counsellors propose; admins approve/reject. The service decides PENDING vs APPROVED from
// the actor's role, so these controllers stay dumb.
export async function submitEntranceExam(req: Request, res: Response): Promise<void> {
  res.status(201).json(await careerLibraryService.submitEntranceExam(req.body, actorOf(req)));
}
export async function submitCourse(req: Request, res: Response): Promise<void> {
  res.status(201).json(await careerLibraryService.submitCourse(req.body, actorOf(req)));
}
export async function submitInstitution(req: Request, res: Response): Promise<void> {
  res.status(201).json(await careerLibraryService.submitInstitution(req.body, actorOf(req)));
}

export async function approveEntranceExam(req: Request, res: Response): Promise<void> {
  res.status(200).json(await careerLibraryService.approveEntranceExam(req.params.id as string, actorOf(req)));
}
export async function rejectEntranceExam(req: Request, res: Response): Promise<void> {
  res
    .status(200)
    .json(await careerLibraryService.rejectEntranceExam(req.params.id as string, actorOf(req), req.body.rejectionReason));
}
export async function approveCourse(req: Request, res: Response): Promise<void> {
  res.status(200).json(await careerLibraryService.approveCourse(req.params.id as string, actorOf(req)));
}
export async function rejectCourse(req: Request, res: Response): Promise<void> {
  res
    .status(200)
    .json(await careerLibraryService.rejectCourse(req.params.id as string, actorOf(req), req.body.rejectionReason));
}
export async function approveInstitution(req: Request, res: Response): Promise<void> {
  res.status(200).json(await careerLibraryService.approveInstitution(req.params.id as string, actorOf(req)));
}
export async function rejectInstitution(req: Request, res: Response): Promise<void> {
  res
    .status(200)
    .json(await careerLibraryService.rejectInstitution(req.params.id as string, actorOf(req), req.body.rejectionReason));
}
