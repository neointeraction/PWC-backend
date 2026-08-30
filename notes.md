## Pending items

The tracked list now lives in `docs/pending-items.md` — it has the evidence (file:line),
what "done" looks like for each item, and what's already landed. Short version of what's
still open:

- Server-side PDF rendering, parent/institution report variants, and the unused `Report`
  model. Blocked on a rendering/storage decision.
- Deliberate deferrals: no canonical-lookup-row edit endpoint in Career Library; no
  `Project`↔`Cohort` link and no `Student.cohort` (the real multi-cohort work); cohort
  columns stay plain strings with no FKs; the OpenAPI spec stays hand-maintained.

Done since this file was first written: the reminder scheduler (`src/scheduler/`, node-cron
behind `SCHEDULER_ENABLED`), per-question `timeTakenMs` → composite ARI, and automatic
advancement for the last four workflow stages (chart save, chart `/finalize`, feedback
pair, report delivery → `CLOSED`).
