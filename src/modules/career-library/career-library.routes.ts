import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as careerLibraryController from "./career-library.controller.js";
import { careerLibraryIdParamsSchema, listCareerLibraryQuerySchema } from "./career-library.schema.js";

export const careerLibraryRouter = Router();

careerLibraryRouter.get(
  "/",
  validate({ query: listCareerLibraryQuerySchema }),
  asyncHandler(careerLibraryController.listCareerLibraryEntries)
);

// Must come before "/:id" so "filters" isn't parsed as an id.
careerLibraryRouter.get("/filters", asyncHandler(careerLibraryController.getCareerLibraryFilters));

careerLibraryRouter.get(
  "/:id",
  validate({ params: careerLibraryIdParamsSchema }),
  asyncHandler(careerLibraryController.getCareerLibraryEntry)
);
