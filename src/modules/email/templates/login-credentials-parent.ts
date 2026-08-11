import { z } from "zod";
import { heading, paragraph, renderLayout } from "./layout.js";

export const loginCredentialsParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  loginId: z.string().trim().min(1),
  defaultPassword: z.string().trim().min(1),
  loginLink: z.string().url(),
});
export type LoginCredentialsParentData = z.infer<typeof loginCredentialsParentDataSchema>;

export function renderLoginCredentialsParentEmail(data: LoginCredentialsParentData) {
  const { parentName, studentName, loginId, defaultPassword, loginLink } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(
      `The login credentials have been mailed to ${studentName} separately. Sharing the same here for your reference.`
    ),
    heading("Login Credentials"),
    paragraph(`Login ID: ${loginId}`),
    paragraph(`Password: ${defaultPassword}`),
    paragraph(`Login link: <a href="${loginLink}">${loginLink}</a>`),
    paragraph(
      `This is a default password. Please ensure ${studentName} logs in and activates the account, and changes the password on first login.`
    ),
    paragraph(`For your security, please encourage ${studentName} not to share this password with anyone.`),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\nThe login credentials have been mailed to ${studentName} separately. Sharing the same here for your reference.\n\nLogin ID: ${loginId}\nPassword: ${defaultPassword}\nLogin link: ${loginLink}\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Login Credentials for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
