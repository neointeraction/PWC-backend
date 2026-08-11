import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff } from "../../common/middlewares/auth.js";
import * as emailController from "./email.controller.js";
import { sendTemplateEmailBodySchema } from "./email.schema.js";

export const emailRouter = Router();

// Staff-only — sending lifecycle emails is an operational action.
emailRouter.get("/templates", ...requireStaff, asyncHandler(emailController.listTemplates));

emailRouter.post(
  "/send",
  ...requireStaff,
  validate({ body: sendTemplateEmailBodySchema }),
  asyncHandler(emailController.sendTemplateEmail)
);
