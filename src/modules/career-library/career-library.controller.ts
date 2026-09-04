import type { Request, Response } from "express";
import { NotFoundError, UnauthorizedError } from "../../common/errors/AppError.js";
import * as careerLibraryService from "./career-library.service.js";
import type { Actor } from "./career-library.service.js";
import type {
  CareerLibraryIdParams,
  ListCareerEntryProposalsQuery,
  ListCareerLibraryQuery,
  ListCoursesQuery,
  ListEducationEntriesQuery,
  EducationEntryIdParams,
  ListEntranceExamsQuery,
  ListInstitutionsQuery,
  LookupIdParams,
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
  // The list filters to ACTIVE for everyone; do the same for a direct fetch so a student
  // holding an id can't read an admin's still-unpublished draft. Staff need to see it.
  const { role } = actorOf(req);
  const staff = role === "COUNSELLOR" || role === "ADMIN" || role === "SUPER_ADMIN";
  if (entry.status !== "ACTIVE" && !staff) {
    throw new NotFoundError("Career library entry not found");
  }
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

// --- Job role proposals (counsellor submits, admin decides) ---

export async function listCareerEntryProposals(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCareerEntryProposalsQuery;
  res.status(200).json(await careerLibraryService.listCareerEntryProposals(query));
}

export async function getCareerEntryProposal(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CareerLibraryIdParams;
  res.status(200).json(await careerLibraryService.getCareerEntryProposalById(id));
}

export async function approveCareerEntryProposal(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CareerLibraryIdParams;
  const entry = await careerLibraryService.approveCareerEntryProposal(id, actorOf(req));
  res.status(200).json(entry);
}

export async function rejectCareerEntryProposal(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CareerLibraryIdParams;
  res.status(200).json(await careerLibraryService.rejectCareerEntryProposal(id));
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
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.approveEntranceExam(id));
}
export async function rejectEntranceExam(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.rejectEntranceExam(id));
}
export async function approveCourse(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.approveCourse(id));
}
export async function rejectCourse(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.rejectCourse(id));
}
export async function approveInstitution(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.approveInstitution(id));
}
export async function rejectInstitution(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.rejectInstitution(id));
}

export async function updateEntranceExam(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.updateEntranceExam(id, req.body));
}
export async function updateCourse(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.updateCourse(id, req.body));
}
export async function updateInstitution(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as LookupIdParams;
  res.status(200).json(await careerLibraryService.updateInstitution(id, req.body));
}

// ---- Education Path entries (global canonical lookup) ----

export async function listEducationEntries(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListEducationEntriesQuery;
  res.status(200).json(await careerLibraryService.listEducationEntries(query));
}

export async function createEducationEntry(req: Request, res: Response): Promise<void> {
  res.status(201).json(await careerLibraryService.createEducationEntry(req.body, actorOf(req)));
}


export async function updateEducationEntry(req: Request, res: Response): Promise<void> {
  const { entryId } = req.params as unknown as EducationEntryIdParams;
  res.status(200).json(await careerLibraryService.updateEducationEntry(entryId, req.body));
}

export async function deleteEducationEntry(req: Request, res: Response): Promise<void> {
  const { entryId } = req.params as unknown as EducationEntryIdParams;
  res.status(200).json(await careerLibraryService.deleteEducationEntry(entryId));
}

export async function approveEducationEntry(req: Request, res: Response): Promise<void> {
  const { entryId } = req.params as unknown as EducationEntryIdParams;
  res.status(200).json(await careerLibraryService.approveEducationEntry(entryId));
}

export async function rejectEducationEntry(req: Request, res: Response): Promise<void> {
  const { entryId } = req.params as unknown as EducationEntryIdParams;
  res.status(200).json(await careerLibraryService.rejectEducationEntry(entryId));
}

