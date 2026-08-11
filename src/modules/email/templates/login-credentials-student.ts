import { z } from "zod";
import { button, heading, paragraph, renderLayout } from "./layout.js";

export const loginCredentialsStudentDataSchema = z.object({
  studentName: z.string().trim().min(1),
  loginId: z.string().trim().min(1),
  defaultPassword: z.string().trim().min(1),
  loginLink: z.string().url(),
});
export type LoginCredentialsStudentData = z.infer<typeof loginCredentialsStudentDataSchema>;

export function renderLoginCredentialsStudentEmail(data: LoginCredentialsStudentData) {
  const { studentName, loginId, defaultPassword, loginLink } = data;

  const body = [
    paragraph(`Hi ${studentName},`),
    heading("Your Login Credentials"),
    paragraph(`Login ID: ${loginId}`),
    paragraph(`Password: ${defaultPassword}`),
    button("Log In", loginLink),
    paragraph(
      "This is a default password. On first login you'll be asked to change it. This is the step that activates your account."
    ),
    paragraph("For your security, please don't share this password with anyone."),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${studentName},\n\nLogin ID: ${loginId}\nPassword: ${defaultPassword}\nLogin link: ${loginLink}\n\nThis is a default password. On first login you'll be asked to change it, activating your account. Please don't share this password with anyone.\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Login Credentials for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
