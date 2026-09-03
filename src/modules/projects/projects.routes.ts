import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as projectsController from "./projects.controller.js";
import {
  createProjectSchema,
  createProjectWizardSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from "./projects.schema.js";

export const projectsRouter = Router();

// Reads = staff; writes/management = admin. Mirrors the students/counsellors split.
projectsRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createProjectSchema }),
  asyncHandler(projectsController.createProject)
);

// Combined "Finish" call for the create-project wizard: project + student roster +
// counsellor-availability import, all in one transaction. See projects.schema.ts.
projectsRouter.post(
  "/wizard",
  ...requireAdmin,
  validate({ body: createProjectWizardSchema }),
  asyncHandler(projectsController.createProjectWizard)
);

projectsRouter.get(
  "/",
  ...requireStaff,
  validate({ query: listProjectsQuerySchema }),
  asyncHandler(projectsController.listProjects)
);

projectsRouter.get(
  "/:id",
  ...requireStaff,
  validate({ params: projectIdParamsSchema }),
  asyncHandler(projectsController.getProject)
);

projectsRouter.patch(
  "/:id",
  ...requireAdmin,
  validate({ params: projectIdParamsSchema, body: updateProjectSchema }),
  asyncHandler(projectsController.updateProject)
);

// Soft-delete (reversible) — flags the project DELETED; data is preserved.
projectsRouter.delete(
  "/:id",
  ...requireAdmin,
  validate({ params: projectIdParamsSchema }),
  asyncHandler(projectsController.deleteProject)
);

// Hard-delete (irreversible) — permanently purges the project and everything scoped to it.
// Only allowed once the project is CLOSED (or already soft-deleted). Distinct from the
// soft DELETE above, which must stay reversible.
projectsRouter.delete(
  "/:id/purge",
  ...requireAdmin,
  validate({ params: projectIdParamsSchema }),
  asyncHandler(projectsController.purgeProject)
);

// Restore a soft-deleted project back to ACTIVE.
projectsRouter.patch(
  "/:id/restore",
  ...requireAdmin,
  validate({ params: projectIdParamsSchema }),
  asyncHandler(projectsController.restoreProject)
);
