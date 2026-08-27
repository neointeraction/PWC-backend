// In-process cron for the reminder/nudge jobs. Started once from server.ts (never from
// app.ts, so tests and serverless request handlers never spin it up). Guarded by
// SCHEDULER_ENABLED — a no-op when off, so it's safe to leave wired in every environment.
//
// NOTE: this assumes the app runs as a single long-lived process. On a serverless/
// multi-instance deploy, disable it (SCHEDULER_ENABLED=false) and drive runDailyBatch from
// an external cron hitting a trigger endpoint instead, to avoid duplicate/no-op runs.

import cron, { type ScheduledTask } from "node-cron";
import { env } from "../config/env.js";
import { runDailyBatch } from "./jobs.js";

let task: ScheduledTask | null = null;

export function startScheduler(): void {
  if (!env.SCHEDULER_ENABLED) {
    console.log("[scheduler] disabled (SCHEDULER_ENABLED=false)");
    return;
  }
  if (task) return; // already started
  if (!cron.validate(env.SCHEDULER_CRON)) {
    console.error(`[scheduler] invalid SCHEDULER_CRON "${env.SCHEDULER_CRON}" — not started`);
    return;
  }

  task = cron.schedule(
    env.SCHEDULER_CRON,
    () => {
      runDailyBatch()
        .then((r) => console.log(`[scheduler] daily batch complete:`, r))
        .catch((err) => console.error("[scheduler] daily batch failed:", err));
    },
    { timezone: env.SCHEDULER_TIMEZONE }
  );

  console.log(`[scheduler] enabled — cron "${env.SCHEDULER_CRON}" (${env.SCHEDULER_TIMEZONE})`);
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}

export { runDailyBatch, runSessionDayReminders, runFollowUpNudges } from "./jobs.js";
