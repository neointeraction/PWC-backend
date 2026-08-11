import { z } from "zod";
import { emailSchema } from "../../common/validators/shared.js";

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof loginBodySchema>;
