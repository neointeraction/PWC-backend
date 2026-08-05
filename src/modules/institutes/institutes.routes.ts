import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
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

institutesRouter.post(
  "/",
  validate({ body: createInstituteSchema }),
  asyncHandler(institutesController.createInstitute)
);

institutesRouter.get("/", asyncHandler(institutesController.listInstitutes));

institutesRouter.get(
  "/:id",
  validate({ params: instituteIdParamsSchema }),
  asyncHandler(institutesController.getInstitute)
);

institutesRouter.patch(
  "/:id",
  validate({ params: instituteIdParamsSchema, body: updateInstituteSchema }),
  asyncHandler(institutesController.updateInstitute)
);

institutesRouter.delete(
  "/:id",
  validate({ params: instituteIdParamsSchema }),
  asyncHandler(institutesController.deleteInstitute)
);

institutesRouter.post(
  "/:id/classes",
  validate({ params: instituteIdParamsSchema, body: createInstituteClassSchema }),
  asyncHandler(institutesController.createInstituteClass)
);

institutesRouter.get(
  "/:id/classes",
  validate({ params: instituteIdParamsSchema }),
  asyncHandler(institutesController.listInstituteClasses)
);

institutesRouter.post(
  "/:id/classes/:classId/divisions",
  validate({ params: classIdParamsSchema, body: createInstituteDivisionSchema }),
  asyncHandler(institutesController.createInstituteDivision)
);

institutesRouter.get(
  "/:id/classes/:classId/divisions",
  validate({ params: classIdParamsSchema }),
  asyncHandler(institutesController.listInstituteDivisions)
);
