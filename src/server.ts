import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startScheduler } from "./scheduler/index.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
  // In-process reminder/nudge cron — a no-op unless SCHEDULER_ENABLED=true.
  startScheduler();
});
