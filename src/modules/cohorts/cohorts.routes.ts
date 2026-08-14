import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { requireStaff } from "../../common/middlewares/auth.js";
import * as cohortsController from "./cohorts.controller.js";

export const cohortsRouter = Router();

// Read-only list for cohort dropdowns (e.g. admin creating a project). Staff.
cohortsRouter.get("/", ...requireStaff, asyncHandler(cohortsController.listCohorts));
