import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { authenticate } from "../../common/middlewares/auth.js";
import * as authController from "./auth.controller.js";
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
} from "./auth.schema.js";

export const authRouter = Router();

// Registration is deliberately not exposed here — every user in this app (Student,
// Counsellor, Super Admin) is created by an admin/seed with a generated temp password
// (see students.service.ts createStudent, prisma/seed.ts seedSuperAdmin), not
// self-signup.
authRouter.post("/login", validate({ body: loginBodySchema }), asyncHandler(authController.login));
authRouter.post("/refresh", asyncHandler(authController.refresh));
authRouter.post("/logout", asyncHandler(authController.logout));

// Authenticated password change (knows current password). Revokes all sessions.
authRouter.post(
  "/change-password",
  authenticate,
  validate({ body: changePasswordBodySchema }),
  asyncHandler(authController.changePassword)
);

// Forgot-password flow (public). forgot → emails a single-use reset link; reset →
// consumes the token and sets the new password.
authRouter.post(
  "/forgot-password",
  validate({ body: forgotPasswordBodySchema }),
  asyncHandler(authController.forgotPassword)
);
authRouter.post(
  "/reset-password",
  validate({ body: resetPasswordBodySchema }),
  asyncHandler(authController.resetPassword)
);
