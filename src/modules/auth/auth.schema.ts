import { z } from "zod";
import { emailSchema } from "../../common/validators/shared.js";

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

// New-password rules, shared by change-password and reset-password. Kept deliberately
// modest (length only) — tune here if a stronger policy is needed.
const newPasswordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: newPasswordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1),
  newPassword: newPasswordSchema,
});
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
