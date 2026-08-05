import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as formsController from "./forms.controller.js";
import {
  formStudentParamsSchema,
  formTypeParamsSchema,
  getFormTemplateQuerySchema,
  saveFormAnswersBodySchema,
} from "./forms.schema.js";

export const formsRouter = Router();

formsRouter.get(
  "/:formType",
  validate({ params: formTypeParamsSchema, query: getFormTemplateQuerySchema }),
  asyncHandler(formsController.getFormTemplate)
);

formsRouter.get(
  "/:formType/students/:studentId",
  validate({ params: formStudentParamsSchema, query: getFormTemplateQuerySchema }),
  asyncHandler(formsController.getFormSubmission)
);

// Save/update in-progress answers ("Save as Draft" on the source forms). Idempotent —
// can be called repeatedly until the form is submitted.
formsRouter.put(
  "/:formType/students/:studentId",
  validate({ params: formStudentParamsSchema, body: saveFormAnswersBodySchema }),
  asyncHandler(formsController.saveFormDraft)
);

// Finalize: validates all required questions are answered, then locks the submission.
formsRouter.post(
  "/:formType/students/:studentId/submit",
  validate({ params: formStudentParamsSchema, body: saveFormAnswersBodySchema }),
  asyncHandler(formsController.submitForm)
);
