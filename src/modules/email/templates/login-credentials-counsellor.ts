import { z } from "zod";
import { paragraph, renderLayout } from "./layout.js";

export const loginCredentialsCounsellorDataSchema = z.object({
  loginId: z.string().trim().min(1),
  defaultPassword: z.string().trim().min(1),
});
export type LoginCredentialsCounsellorData = z.infer<typeof loginCredentialsCounsellorDataSchema>;

export function renderLoginCredentialsCounsellorEmail(data: LoginCredentialsCounsellorData) {
  const { loginId, defaultPassword } = data;

  const body = [paragraph(`Username: ${loginId}`), paragraph(`Password: ${defaultPassword}`)].join("");

  const text = `Username: ${loginId}\nPassword: ${defaultPassword}`;

  return {
    subject: "Login Credentials for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
