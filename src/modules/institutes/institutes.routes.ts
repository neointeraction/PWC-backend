import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as institutesController from "./institutes.controller.js";
import {
  classIdParamsSchema,
  createInstituteClassSchema,
  createInstituteDivisionSchema,
  createInstituteSchema,
  instituteIdParamsSchema,
  updateInstituteSchema,
} from "./institutes.schema.js";

export const institutesRouter = Router();

// Reads = staff (counsellor + admin); writes = admin (management).
institutesRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createInstituteSchema }),
  asyncHandler(institutesController.createInstitute)
);

institutesRouter.get("/", ...requireStaff, asyncHandler(institutesController.listInstitutes));

institutesRouter.get(
  "/:id",
  ...requireStaff,
  validate({ params: instituteIdParamsSchema }),
  asyncHandler(institutesController.getInstitute)
);

institutesRouter.patch(
  "/:id",
  ...requireAdmin,
  validate({ params: instituteIdParamsSchema, body: updateInstituteSchema }),
  asyncHandler(institutesController.updateInstitute)
);

institutesRouter.delete(
  "/:id",
  ...requireAdmin,
  validate({ params: instituteIdParamsSchema }),
  asyncHandler(institutesController.deleteInstitute)
);

institutesRouter.post(
  "/:id/classes",
  ...requireAdmin,
  validate({ params: instituteIdParamsSchema, body: createInstituteClassSchema }),
  asyncHandler(institutesController.createInstituteClass)
);

institutesRouter.get(
  "/:id/classes",
  ...requireStaff,
  validate({ params: instituteIdParamsSchema }),
  asyncHandler(institutesController.listInstituteClasses)
);

institutesRouter.post(
  "/:id/classes/:classId/divisions",
  ...requireAdmin,
  validate({ params: classIdParamsSchema, body: createInstituteDivisionSchema }),
  asyncHandler(institutesController.createInstituteDivision)
);

institutesRouter.get(
  "/:id/classes/:classId/divisions",
  ...requireStaff,
  validate({ params: classIdParamsSchema }),
  asyncHandler(institutesController.listInstituteDivisions)
);
