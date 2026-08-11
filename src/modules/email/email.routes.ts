import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as emailController from "./email.controller.js";
import { sendTemplateEmailBodySchema } from "./email.schema.js";

export const emailRouter = Router();

emailRouter.get("/templates", asyncHandler(emailController.listTemplates));

emailRouter.post(
  "/send",
  validate({ body: sendTemplateEmailBodySchema }),
  asyncHandler(emailController.sendTemplateEmail)
);
