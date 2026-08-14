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
  listEntranceExamsQuerySchema,
  listInstitutionsQuerySchema,
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

// Create a library entry (admin). New entries default to DRAFT; publish by setting ACTIVE.
careerLibraryRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createCareerEntrySchema }),
  asyncHandler(careerLibraryController.createCareerLibraryEntry)
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
