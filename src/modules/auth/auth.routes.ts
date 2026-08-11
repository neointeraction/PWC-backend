import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as authController from "./auth.controller.js";
import { loginBodySchema } from "./auth.schema.js";

export const authRouter = Router();

// Registration is deliberately not exposed here — every user in this app (Student,
// Counsellor, Super Admin) is created by an admin/seed with a generated temp password
// (see students.service.ts createStudent, prisma/seed.ts seedSuperAdmin), not
// self-signup.
authRouter.post("/login", validate({ body: loginBodySchema }), asyncHandler(authController.login));
authRouter.post("/refresh", asyncHandler(authController.refresh));
authRouter.post("/logout", asyncHandler(authController.logout));
