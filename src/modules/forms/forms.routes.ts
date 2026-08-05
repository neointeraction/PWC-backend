import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as formsController from "./forms.controller.js";
import { formTypeParamsSchema, getFormTemplateQuerySchema } from "./forms.schema.js";

export const formsRouter = Router();

formsRouter.get(
  "/:formType",
  validate({ params: formTypeParamsSchema, query: getFormTemplateQuerySchema }),
  asyncHandler(formsController.getFormTemplate)
);
