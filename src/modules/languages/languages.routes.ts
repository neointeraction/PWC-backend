import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { requireStaff } from "../../common/middlewares/auth.js";
import * as languagesController from "./languages.controller.js";

export const languagesRouter = Router();

// Read-only list for the language dropdown (e.g. admin creating a project). Staff.
languagesRouter.get("/", ...requireStaff, asyncHandler(languagesController.listLanguages));
