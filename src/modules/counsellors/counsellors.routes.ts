import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as counsellorsController from "./counsellors.controller.js";
import {
  assignProjectBodySchema,
  counsellorIdParamsSchema,
  counsellorProjectParamsSchema,
  createCounsellorSchema,
  listCounsellorsQuerySchema,
  updateCounsellorSchema,
} from "./counsellors.schema.js";

export const counsellorsRouter = Router();

// Reads = staff (counsellor + admin); writes/management = admin (create/edit/delete,
// project assignment). Mirrors the students/institutes access split.
counsellorsRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createCounsellorSchema }),
  asyncHandler(counsellorsController.createCounsellor)
);

counsellorsRouter.get(
  "/",
  ...requireStaff,
  validate({ query: listCounsellorsQuerySchema }),
  asyncHandler(counsellorsController.listCounsellors)
);

counsellorsRouter.get(
  "/:id",
  ...requireStaff,
  validate({ params: counsellorIdParamsSchema }),
  asyncHandler(counsellorsController.getCounsellor)
);

counsellorsRouter.patch(
  "/:id",
  ...requireAdmin,
  validate({ params: counsellorIdParamsSchema, body: updateCounsellorSchema }),
  asyncHandler(counsellorsController.updateCounsellor)
);

counsellorsRouter.delete(
  "/:id",
  ...requireAdmin,
  validate({ params: counsellorIdParamsSchema }),
  asyncHandler(counsellorsController.deleteCounsellor)
);

// Project assignment (ProjectCounsellor join table).
counsellorsRouter.post(
  "/:id/projects",
  ...requireAdmin,
  validate({ params: counsellorIdParamsSchema, body: assignProjectBodySchema }),
  asyncHandler(counsellorsController.assignProject)
);

counsellorsRouter.delete(
  "/:id/projects/:projectId",
  ...requireAdmin,
  validate({ params: counsellorProjectParamsSchema }),
  asyncHandler(counsellorsController.unassignProject)
);
