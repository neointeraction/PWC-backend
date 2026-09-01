import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // Frontend base URL used to build user-facing links in emails (e.g. the password
  // reset link `${APP_WEB_URL}/reset-password?token=...`).
  APP_WEB_URL: z.string().url().default("http://localhost:3000"),
  // How long a forgot-password reset token stays valid.
  PASSWORD_RESET_EXPIRES_IN: z.string().default("1h"),

  // Bootstraps the one SUPER_ADMIN account (prisma/seed.ts) — there's no self-register
  // endpoint, so this is the only way to get a first login. Change the password after
  // first login in any non-local environment.
  SEED_SUPER_ADMIN_EMAIL: z.string().email().default("superadmin@kreate.local"),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),

  // Email — EMAIL_PROVIDER selects the active provider so it can be swapped without
  // touching call sites. "console" just logs the email (safe default for local dev).
  EMAIL_PROVIDER: z.enum(["console", "mailgun"]).default("console"),
  EMAIL_FROM_NAME: z.string().default("Team kREATE"),
  EMAIL_FROM_ADDRESS: z.string().email().default("noreply@example.com"),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  // "us" (Mailgun's American endpoint, api.mailgun.net) or "eu" (api.eu.mailgun.net).
  MAILGUN_REGION: z.enum(["us", "eu"]).default("us"),
  // Fixed inbox for operational alerts that aren't addressed to a specific student/
  // parent/counsellor (currently: session no-show flags — see sessions.service.ts).
  // No code path queries ADMIN/SUPER_ADMIN users for this; it's config, not a lookup.
  ADMIN_NOTIFICATION_EMAIL: z.string().email().default("admin@kreate.local"),

  // In-process reminder/nudge scheduler (src/scheduler). Off by default so it never runs
  // in tests or serverless invocations; enable it only where the app runs as a single
  // long-lived process. Query-param-style boolean: only the literal "true" enables it
  // (z.coerce.boolean would treat "false" as true).
  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
  // Daily run time, cron format, in SCHEDULER_TIMEZONE. Default 08:00 — sends same-day
  // session reminders and idle/missed follow-up nudges each morning.
  SCHEDULER_CRON: z.string().default("0 8 * * *"),
  SCHEDULER_TIMEZONE: z.string().default("Asia/Kolkata"),
  // Don't re-nudge the same student more often than this many days (avoids daily spam
  // while they stay idle).
  IDLE_NUDGE_COOLDOWN_DAYS: z.coerce.number().int().positive().default(2),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

if (parsed.data.EMAIL_PROVIDER === "mailgun" && (!parsed.data.MAILGUN_API_KEY || !parsed.data.MAILGUN_DOMAIN)) {
  console.error("MAILGUN_API_KEY and MAILGUN_DOMAIN are required when EMAIL_PROVIDER=mailgun");
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
