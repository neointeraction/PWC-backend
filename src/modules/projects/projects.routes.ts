import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as projectsController from "./projects.controller.js";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from "./projects.schema.js";

export const projectsRouter = Router();

// Reads = staff; writes/management = admin. Mirrors the students/institutes/counsellors split.
projectsRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createProjectSchema }),
  asyncHandler(projectsController.createProject)
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

projectsRouter.delete(
  "/:id",
  ...requireAdmin,
  validate({ params: projectIdParamsSchema }),
  asyncHandler(projectsController.deleteProject)
);
