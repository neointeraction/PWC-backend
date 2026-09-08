import { z } from "zod";

// E.164: optional leading +, 1-15 digits, first digit non-zero.
const E164_REGEX = /^\+?[1-9]\d{1,14}$/;

// Normalize the +91 country code away so every stored number is in the same
// (country-code-less) shape, regardless of how the client sends it.
function stripIndiaCountryCode(value: string): string {
  if (value.startsWith("+91")) return value.slice(3);
  if (value.startsWith("0091")) return value.slice(4);
  return value;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform(stripIndiaCountryCode)
  .refine((value) => E164_REGEX.test(value), {
    message: "Phone number must be a valid number, e.g. 9876543210",
  });

export const emailSchema = z.string().trim().toLowerCase().email();
