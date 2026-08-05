import { z } from "zod";

// E.164: optional leading +, 1-15 digits, first digit non-zero.
const E164_REGEX = /^\+?[1-9]\d{1,14}$/;

export const phoneSchema = z
  .string()
  .trim()
  .regex(E164_REGEX, "Phone number must be in E.164 format, e.g. +919876543210");

export const emailSchema = z.string().trim().toLowerCase().email();
