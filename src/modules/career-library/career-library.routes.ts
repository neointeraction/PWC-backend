import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireAuth, requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as careerLibraryController from "./career-library.controller.js";
import {
  approveCareerRequestSchema,
  careerLibraryIdParamsSchema,
  careerRequestIdParamsSchema,
  createCareerEntrySchema,
  createCareerRequestSchema,
  listCareerLibraryQuerySchema,
  listCareerRequestsQuerySchema,
  listCoursesQuerySchema,
  createEducationEntrySchema,
  educationEntryIdParamsSchema,
  listEducationEntriesQuerySchema,
  rejectEducationEntrySchema,
  updateEducationEntrySchema,
  listEntranceExamsQuerySchema,
  listInstitutionsQuerySchema,
  lookupIdParamsSchema,
  rejectLookupSchema,
  submitCourseSchema,
  submitEntranceExamSchema,
  submitInstitutionSchema,
  updateCareerEntrySchema,
} from "./career-library.schema.js";

export const careerLibraryRouter = Router();

// Reads = any authenticated user (students browse too). Entry writes = admin. The
// ratification request flow: counsellors submit, admins review.
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
// Staff (counsellors included) may propose an entry; a counsellor's lands PENDING and only
// an admin can approve it into the pickers. Editing/removing a row is Admin.
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
  validate({ params: educationEntryIdParamsSchema, body: rejectEducationEntrySchema }),
  asyncHandler(careerLibraryController.rejectEducationEntry)
);
careerLibraryRouter.post(
  "/education/:entryId/restore",
  ...requireAdmin,
  validate({ params: educationEntryIdParamsSchema }),
  asyncHandler(careerLibraryController.restoreEducationEntry)
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

// Create a library entry (admin). New entries default to DRAFT; publish by setting ACTIVE.
careerLibraryRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createCareerEntrySchema }),
  asyncHandler(careerLibraryController.createCareerLibraryEntry)
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
  validate({ params: lookupIdParamsSchema, body: rejectLookupSchema }),
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
  validate({ params: lookupIdParamsSchema, body: rejectLookupSchema }),
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
  validate({ params: lookupIdParamsSchema, body: rejectLookupSchema }),
  asyncHandler(careerLibraryController.rejectInstitution)
);

// --- Ratification requests (declared before "/:id" so "requests" isn't parsed as an id) ---
careerLibraryRouter.post(
  "/requests",
  ...requireStaff,
  validate({ body: createCareerRequestSchema }),
  asyncHandler(careerLibraryController.createCareerRequest)
);
careerLibraryRouter.get(
  "/requests",
  ...requireStaff,
  validate({ query: listCareerRequestsQuerySchema }),
  asyncHandler(careerLibraryController.listCareerRequests)
);
careerLibraryRouter.get(
  "/requests/:requestId",
  ...requireStaff,
  validate({ params: careerRequestIdParamsSchema }),
  asyncHandler(careerLibraryController.getCareerRequest)
);
careerLibraryRouter.post(
  "/requests/:requestId/approve",
  ...requireAdmin,
  validate({ params: careerRequestIdParamsSchema, body: approveCareerRequestSchema }),
  asyncHandler(careerLibraryController.approveCareerRequest)
);
careerLibraryRouter.post(
  "/requests/:requestId/reject",
  ...requireAdmin,
  validate({ params: careerRequestIdParamsSchema }),
  asyncHandler(careerLibraryController.rejectCareerRequest)
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
