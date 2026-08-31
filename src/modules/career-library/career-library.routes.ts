import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireAuth, requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as careerLibraryController from "./career-library.controller.js";
import {
  careerLibraryIdParamsSchema,
  createCareerEntrySchema,
  listCareerEntryProposalsQuerySchema,
  listCareerLibraryQuerySchema,
  listCoursesQuerySchema,
  createEducationEntrySchema,
  educationEntryIdParamsSchema,
  listEducationEntriesQuerySchema,
  updateEducationEntrySchema,
  listEntranceExamsQuerySchema,
  listInstitutionsQuerySchema,
  lookupIdParamsSchema,
  submitCourseSchema,
  submitEntranceExamSchema,
  submitInstitutionSchema,
  updateCareerEntrySchema,
} from "./career-library.schema.js";

export const careerLibraryRouter = Router();

// Reads = any authenticated user (students browse too). Entry writes = admin; a
// counsellor's write is staged as a CareerLibraryEntryProposal instead (see below).
careerLibraryRouter.get(
  "/",
  ...requireAuth,
  validate({ query: listCareerLibraryQuerySchema }),
  asyncHandler(careerLibraryController.listCareerLibraryEntries)
);

// Must come before "/:id" so "filters" isn't parsed as an id.
careerLibraryRouter.get("/filters", ...requireAuth, asyncHandler(careerLibraryController.getCareerLibraryFilters));

// Dropdown / typeahead lookups for the "select existing" multiselects (before "/:id").
careerLibraryRouter.get(
  "/entrance-exams",
  ...requireAuth,
  validate({ query: listEntranceExamsQuerySchema }),
  asyncHandler(careerLibraryController.listEntranceExams)
);
careerLibraryRouter.get(
  "/institutions",
  ...requireAuth,
  validate({ query: listInstitutionsQuerySchema }),
  asyncHandler(careerLibraryController.listInstitutions)
);
careerLibraryRouter.get(
  "/courses",
  ...requireAuth,
  validate({ query: listCoursesQuerySchema }),
  asyncHandler(careerLibraryController.listCourses)
);
careerLibraryRouter.get(
  "/education",
  ...requireAuth,
  validate({ query: listEducationEntriesQuerySchema }),
  asyncHandler(careerLibraryController.listEducationEntries)
);

// --- Education Path entries (global canonical lookup) ---
// Staff (counsellors included) may propose an entry; a counsellor's lands DRAFT (this table
// carries DRAFT/ACTIVE, not a ReviewStatus) and only an admin's approve publishes it into
// the pickers. Reject deletes it. Editing/removing a row is Admin.
careerLibraryRouter.post(
  "/education",
  ...requireStaff,
  validate({ body: createEducationEntrySchema }),
  asyncHandler(careerLibraryController.createEducationEntry)
);
careerLibraryRouter.post(
  "/education/:entryId/approve",
  ...requireAdmin,
  validate({ params: educationEntryIdParamsSchema }),
  asyncHandler(careerLibraryController.approveEducationEntry)
);
careerLibraryRouter.post(
  "/education/:entryId/reject",
  ...requireAdmin,
  validate({ params: educationEntryIdParamsSchema }),
  asyncHandler(careerLibraryController.rejectEducationEntry)
);
careerLibraryRouter.patch(
  "/education/:entryId",
  ...requireAdmin,
  validate({ params: educationEntryIdParamsSchema, body: updateEducationEntrySchema }),
  asyncHandler(careerLibraryController.updateEducationEntry)
);
careerLibraryRouter.delete(
  "/education/:entryId",
  ...requireAdmin,
  validate({ params: educationEntryIdParamsSchema }),
  asyncHandler(careerLibraryController.deleteEducationEntry)
);

// Create a library entry (staff). Two paths through the same payload:
//   - admin/super admin: added straight to the library (DRAFT by default, ACTIVE if asked);
//   - counsellor: staged as a CareerLibraryEntryProposal (below) — never written here.
careerLibraryRouter.post(
  "/",
  ...requireStaff,
  validate({ body: createCareerEntrySchema }),
  asyncHandler(careerLibraryController.createCareerLibraryEntry)
);

// --- Job role proposals (counsellor submits, admin reviews) ---
// Declared before "/:id" so the literal "proposals" segment wins.
careerLibraryRouter.get(
  "/proposals",
  ...requireStaff,
  validate({ query: listCareerEntryProposalsQuerySchema }),
  asyncHandler(careerLibraryController.listCareerEntryProposals)
);
careerLibraryRouter.get(
  "/proposals/:id",
  ...requireStaff,
  validate({ params: careerLibraryIdParamsSchema }),
  asyncHandler(careerLibraryController.getCareerEntryProposal)
);
careerLibraryRouter.post(
  "/proposals/:id/approve",
  ...requireAdmin,
  validate({ params: careerLibraryIdParamsSchema }),
  asyncHandler(careerLibraryController.approveCareerEntryProposal)
);
careerLibraryRouter.post(
  "/proposals/:id/reject",
  ...requireAdmin,
  validate({ params: careerLibraryIdParamsSchema }),
  asyncHandler(careerLibraryController.rejectCareerEntryProposal)
);

// --- Reference data proposed on its own (counsellor) + review (admin) ---
// The inline "add new" in the job-role form is admin-only because that form is; these are
// the paths a counsellor uses. Declared before "/:id" so the literal segments win.
careerLibraryRouter.post(
  "/entrance-exams",
  ...requireStaff,
  validate({ body: submitEntranceExamSchema }),
  asyncHandler(careerLibraryController.submitEntranceExam)
);
careerLibraryRouter.post(
  "/courses",
  ...requireStaff,
  validate({ body: submitCourseSchema }),
  asyncHandler(careerLibraryController.submitCourse)
);
careerLibraryRouter.post(
  "/institutions",
  ...requireStaff,
  validate({ body: submitInstitutionSchema }),
  asyncHandler(careerLibraryController.submitInstitution)
);

careerLibraryRouter.post(
  "/entrance-exams/:id/approve",
  ...requireAdmin,
  validate({ params: lookupIdParamsSchema }),
  asyncHandler(careerLibraryController.approveEntranceExam)
);
careerLibraryRouter.post(
  "/entrance-exams/:id/reject",
  ...requireAdmin,
  validate({ params: lookupIdParamsSchema }),
  asyncHandler(careerLibraryController.rejectEntranceExam)
);
careerLibraryRouter.post(
  "/courses/:id/approve",
  ...requireAdmin,
  validate({ params: lookupIdParamsSchema }),
  asyncHandler(careerLibraryController.approveCourse)
);
careerLibraryRouter.post(
  "/courses/:id/reject",
  ...requireAdmin,
  validate({ params: lookupIdParamsSchema }),
  asyncHandler(careerLibraryController.rejectCourse)
);
careerLibraryRouter.post(
  "/institutions/:id/approve",
  ...requireAdmin,
  validate({ params: lookupIdParamsSchema }),
  asyncHandler(careerLibraryController.approveInstitution)
);
careerLibraryRouter.post(
  "/institutions/:id/reject",
  ...requireAdmin,
  validate({ params: lookupIdParamsSchema }),
  asyncHandler(careerLibraryController.rejectInstitution)
);

// --- Single entry by id (must be last: "/:id" is a catch-all) ---
careerLibraryRouter.get(
  "/:id",
  ...requireAuth,
  validate({ params: careerLibraryIdParamsSchema }),
  asyncHandler(careerLibraryController.getCareerLibraryEntry)
);

careerLibraryRouter.patch(
  "/:id",
  ...requireAdmin,
  validate({ params: careerLibraryIdParamsSchema, body: updateCareerEntrySchema }),
  asyncHandler(careerLibraryController.updateCareerLibraryEntry)
);

careerLibraryRouter.delete(
  "/:id",
  ...requireAdmin,
  validate({ params: careerLibraryIdParamsSchema }),
  asyncHandler(careerLibraryController.deleteCareerLibraryEntry)
);
