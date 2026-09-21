import { z } from "zod";
import { emailSchema } from "../../common/validators/shared.js";

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

// New-password policy, shared by change-password and reset-password. Keep in sync with the
// frontend's src/utils/password.ts, which shows the same rules to the user as they type.
// Only applies to passwords a user chooses — admin-issued temp passwords bypass it.
const newPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/\d/, "Password must include a number")
  .regex(/[^A-Za-z0-9\s]/, "Password must include a special character")
  .regex(/^\S+$/, "Password must not contain spaces");

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
