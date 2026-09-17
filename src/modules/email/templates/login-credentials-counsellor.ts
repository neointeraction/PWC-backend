import { z } from "zod";
import { button, heading, paragraph, renderLayout } from "./layout.js";

export const loginCredentialsCounsellorDataSchema = z.object({
  counsellorName: z.string().trim().min(1),
  loginId: z.string().trim().min(1),
  defaultPassword: z.string().trim().min(1),
  loginLink: z.string().url(),
});
export type LoginCredentialsCounsellorData = z.infer<typeof loginCredentialsCounsellorDataSchema>;

export function renderLoginCredentialsCounsellorEmail(data: LoginCredentialsCounsellorData) {
  const { counsellorName, loginId, defaultPassword, loginLink } = data;

  const body = [
    paragraph(`Hi ${counsellorName},`),
    heading("Your Login Credentials"),
    paragraph(`Login ID: ${loginId}`),
    paragraph(`Password: ${defaultPassword}`),
    button("Log In", loginLink),
    paragraph("This is a default password. On first login you'll be asked to change it."),
    paragraph("For your security, please don't share this password with anyone."),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${counsellorName},\n\nYour Login Credentials\nLogin ID: ${loginId}\nPassword: ${defaultPassword}\n\nLog in: ${loginLink}\n\nThis is a default password. On first login you'll be asked to change it.\n\nFor your security, please don't share this password with anyone.\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Login Credentials for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
