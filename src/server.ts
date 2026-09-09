import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { loadScoringReferenceData } from "./modules/assessment/scoring/data/store.js";
import { startScheduler } from "./scheduler/index.js";

const app = createApp();

// Fail fast at boot if the assessment scoring reference tables are unseeded, rather
// than throwing on the first assessment submission.
await loadScoringReferenceData();

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
  // In-process reminder/nudge cron — a no-op unless SCHEDULER_ENABLED=true.
  startScheduler();
});
