import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { authenticateStudentForm, requireStudentOrStaff } from "../../common/middlewares/auth.js";
import { ownStudentForm, ownStudentParam } from "../../common/middlewares/ownership.js";
import * as formsController from "./forms.controller.js";
import {
  formStudentParamsSchema,
  formTypeParamsSchema,
  getFormTemplateQuerySchema,
  saveFormAnswersBodySchema,
  studentFormStatusParamsSchema,
} from "./forms.schema.js";

export const formsRouter = Router();

// Per-form submission flags for a student (pre-counselling + feedback, student + parent)
// — for reminder/link logic. Declared before the `/:formType` routes so "students" isn't
// treated as a formType.
formsRouter.get(
  "/students/:studentId/status",
  ...requireStudentOrStaff,
  validate({ params: studentFormStatusParamsSchema }),
  ownStudentParam,
  asyncHandler(formsController.getFormStatus)
);

// `authenticateStudentForm` branches on `:formType` — parent forms are public (parents
// have no login), student forms require the student or staff to be authenticated.
formsRouter.get(
  "/:formType",
  authenticateStudentForm,
  validate({ params: formTypeParamsSchema, query: getFormTemplateQuerySchema }),
  asyncHandler(formsController.getFormTemplate)
);

formsRouter.get(
  "/:formType/students/:studentId",
  authenticateStudentForm,
  validate({ params: formStudentParamsSchema, query: getFormTemplateQuerySchema }),
  ownStudentForm,
  asyncHandler(formsController.getFormSubmission)
);

// Save/update in-progress answers ("Save as Draft" on the source forms). Idempotent —
// can be called repeatedly until the form is submitted.
formsRouter.put(
  "/:formType/students/:studentId",
  authenticateStudentForm,
  validate({ params: formStudentParamsSchema, body: saveFormAnswersBodySchema }),
  ownStudentForm,
  asyncHandler(formsController.saveFormDraft)
);

// Finalize: validates all required questions are answered, then locks the submission.
formsRouter.post(
  "/:formType/students/:studentId/submit",
  authenticateStudentForm,
  validate({ params: formStudentParamsSchema, body: saveFormAnswersBodySchema }),
  ownStudentForm,
  asyncHandler(formsController.submitForm)
);
