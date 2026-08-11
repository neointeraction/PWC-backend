import { z } from "zod";
import { button, heading, paragraph, renderLayout } from "./layout.js";

export const passwordResetDataSchema = z.object({
  name: z.string().trim().min(1),
  resetLink: z.string().url(),
  expiresInText: z.string().trim().min(1), // e.g. "1 hour"
});
export type PasswordResetData = z.infer<typeof passwordResetDataSchema>;

export function renderPasswordResetEmail(data: PasswordResetData) {
  const { name, resetLink, expiresInText } = data;

  const body = [
    paragraph(`Hi ${name},`),
    heading("Reset Your Password"),
    paragraph("We received a request to reset your kREATE account password. Click the button below to choose a new one."),
    button("Reset Password", resetLink),
    paragraph(`This link expires in ${expiresInText} and can be used once.`),
    paragraph("If you didn't request this, you can safely ignore this email — your password won't change."),
  ].join("");

  const text = `Hi ${name},\n\nWe received a request to reset your kREATE account password. Use the link below to choose a new one:\n${resetLink}\n\nThis link expires in ${expiresInText} and can be used once. If you didn't request this, you can safely ignore this email — your password won't change.\n\nTeam kREATE | Design Destiny`;

  return {
    subject: "Reset your kREATE password",
    html: renderLayout(body),
    text,
  };
}
