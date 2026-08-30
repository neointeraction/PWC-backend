# Pending Items

Working list of what is still open in this backend, derived from the code (not just
from memory). Keep it updated as items land — tick the box, note the commit.

**Baseline when written:** 2026-08-30, `master` @ `e1bb886`, working tree clean,
`pnpm typecheck` clean, `pnpm test` green (247 tests / 33 files).

---

## 1. Open items — code

### 1.1 Assessment: per-question timing is dropped, so composite ARI can never activate

**Status:** [x] DONE — 2026-08-30

The scoring engine already implements the Aptitude Reliability Index
(`DC × 0.6 + TC × 0.4`, `src/modules/assessment/scoring/ari.ts`) and the DB already
has the column (`AssessmentAnswer.timeTakenMs`, `prisma/schema.prisma:1058`). What is
missing is the plumbing in between:

- `saveAssessmentAnswersBodySchema` (`src/modules/assessment/assessment.schema.ts:20`)
  accepts only `{ fieldKey, selectedOption }` — no `timeTakenMs`.
- `saveAnswers` (`src/modules/assessment/assessment.service.ts:148`) never writes the
  column on create or update.

So a frontend that starts sending timing today would have it silently discarded, and
Time Consistency / composite ARI stay `null` forever
(`ari.ts:106` bails unless *every* aptitude answer carries a value).

**Done when:** the save-answers DTO accepts an optional non-negative `timeTakenMs`, the
service persists it (upsert create + update), a test proves an attempt answered with
timing produces a non-null `reliability.ari`, and `meta.pending` no longer lists ARI for
that case. Docs: `docs/api-list.md`, `docs/frontend-integration-guide.md`, OpenAPI
(`src/config/openapi.ts`).

**Size:** small.

**What landed:**

- `assessment.schema.ts` — `timeTakenMs` (optional, non-negative int, nullable) on both
  the save-answers DTO and the dev `score-preview` DTO. OpenAPI picks this up
  automatically since `registry.registerPath` reuses the Zod schemas.
- `assessment.service.ts` — `saveAssessmentAnswers` persists it (omitted ⇒ existing value
  preserved, explicit `null` ⇒ cleared); the preview path forwards it into the engine
  instead of hardcoding `null`.
- `scoring/index.ts` — `meta.pending` no longer lists `timeConsistency`/`ari`
  unconditionally; they drop out once `ari.timingAvailable` is true.
- Tests: 2 unit (`assessment-scoring.test.ts` — full timing ⇒ ARI 100 and not pending;
  partial timing ⇒ still deferred) + 2 integration (`assessment-submission.test.ts` —
  persistence/preserve/clear/reject-negative, and a submitted attempt yielding a non-null
  composite ARI).
- Docs: `docs/api-list.md`, `docs/frontend-integration-guide.md` §8.3/§8.4/§13. Note the
  guide already *documented* `timeTakenMs` before it worked — the field was silently
  dropped; that contract is now real.

**Follow-up — DONE 2026-08-30:** the dev tester at `public/assessment-tester.html` now
sends timing. A **Per-question timing** selector offers `off` (the deferred
`meta.pending` path), `measured` (real dwell time between successive answer clicks) and
three synthetic modes — `unhurried` (20s, no TC penalty), `rushed` (2s, penalties fire on
hard/wrong items) and `mixed` (random 1–15s, straddling the 5s threshold). The score
status line reports how many aptitude answers carried timing and whether that's enough
for ARI to compute. Also fixed a latent bug in the same file: the ARI row read
`reliability.ari.ari` as a scalar and the band as `reliability.ari.level`, so a computed
ARI would have rendered `[object Object]` with a blank band — invisible while ARI was
always null.

### 1.2 Workflow: the last four lifecycle stages never advance on their own

**Status:** [x] DONE — 2026-08-30

`WORKFLOW_STATUS_ORDER` (`src/common/workflow/workflowStatus.ts`) has 12 stages, but
`advanceWorkflowStatus` is only ever called from students, forms, assessment and
sessions. Nothing advances the tail of the lifecycle:

| Stage | Expected trigger | Today |
| --- | --- | --- |
| `COUNSELLOR_FEEDBACK_REPORT` | counsellor completes the chart after Session 1 | never set |
| `SESSION_2_COMPLETED` | session join/no-show marking | ✅ set by sessions |
| `COUNSELLOR_FEEDBACK` | counsellor chart `/finalize` | never set |
| `STUDENT_PARENT_FEEDBACK` | `FEEDBACK_STUDENT` + `FEEDBACK_PARENT` both submitted | never set |
| `CLOSED` | case closure | never set |

Specifics:

- `prisma/schema.prisma:1121` documents `CounsellorChart.finalizedAt` as "set on
  /finalize, which advances workflow to COUNSELLOR_FEEDBACK" — **there is no
  `/finalize` route** in `src/modules/counsellor-chart/counsellor-chart.routes.ts`, and
  nothing anywhere in `src/` writes `finalizedAt`. `reports.service.ts:109` therefore
  reports `meta.finalized` off a field that is structurally always `null`.
- `forms.service.ts:157` advances only on the **pre-counselling** pair
  (`PRE_COUNSELLING_COUNTERPART`); the feedback pair has no equivalent hook.

Until this is closed, those stages are reachable only through the admin override
`PATCH /api/v1/students/:id/workflow-status`.

**Done when:** chart save advances to `COUNSELLOR_FEEDBACK_REPORT`; a new staff-only
`POST /api/v1/counsellor-chart/students/:studentId/finalize` sets `finalizedAt` and
advances to `COUNSELLOR_FEEDBACK` (idempotent, and guarded so it can't finalize an empty
chart); submitting both feedback forms advances to `STUDENT_PARENT_FEEDBACK`; a decision
is recorded for what sets `CLOSED` (admin action vs. automatic on feedback + finalize).
Tests cover each hop. Docs: `docs/api-list.md`, `docs/db-design.md`,
`docs/frontend-integration-guide.md`, OpenAPI.

**Size:** medium. Needs one product decision (`CLOSED` trigger).

**Decisions taken:** `COUNSELLOR_FEEDBACK_REPORT` advances on the first chart save
carrying real content (no extra button for the frontend); `CLOSED` fires when the
**student** receives their report.

**What landed:**

- `counsellor-chart.service.ts` — a chart save with real content advances to
  `COUNSELLOR_FEEDBACK_REPORT` (`lastEditedBy` alone doesn't count, it's an audit stamp);
  new `finalizeCounsellorChart` stamps `finalizedAt` and advances to
  `COUNSELLOR_FEEDBACK`. Idempotent (re-finalize keeps the original timestamp), 400 on an
  empty chart.
- `POST /api/v1/counsellor-chart/students/:studentId/finalize` — staff-only, optional
  `{ finalizedBy }` body.
- `forms.service.ts` — the `PRE_COUNSELLING_COUNTERPART` map became `FORM_PAIRS`
  (counterpart + the stage the completed pair reaches), so the feedback pair now advances
  to `STUDENT_PARENT_FEEDBACK` the same way the pre-counselling pair always has.
- `reports.service.ts` / `.controller.ts` — `markReportDeliveredToStudent`. Two guards:
  only the student's **own** fetch counts (a staff fetch is a review, not delivery), and
  it only fires from `STUDENT_PARENT_FEEDBACK` — without that, `advanceWorkflowStatus`
  jumps straight to the target and an early fetch (the report is readable as soon as the
  assessment is scored) would skip the whole tail. Best-effort: a failure is logged, not
  raised, since the report is the deliverable.
- `test/workflow-lifecycle.test.ts` — 10 tests walking the tail end to end, including the
  three negative cases (audit-stamp-only save, empty-chart finalize, early student fetch)
  and staff-fetch-doesn't-close.
- Docs: `docs/api-list.md` (new **Workflow stage triggers** table covering all 12 stages,
  plus the finalize route), `docs/db-design.md`, `docs/frontend-integration-guide.md` §13,
  `prisma/schema.prisma` (the `finalizedAt` comment described a route that didn't exist).
- OpenAPI: registered the finalize route **and** the four other counsellor-chart routes
  and both feedback routes — those two modules were missing from the hand-maintained spec
  entirely. Spec now builds 94 paths.

### 1.3 Reports: no server-side PDF, no parent/institution variants, `Report` model unused

**Status:** [x] RESOLVED BY DECISION — 2026-08-30 (closed, not built)

`GET /api/v1/reports/students/:id/assessment` returns the assembled report as JSON and
the frontend renders/prints it. Meanwhile the schema already anticipates the finished
shape and nothing uses it:

- `ReportType` enum has `STUDENT_CAREER_PATH`, `PARENT_SUMMARY`, `INSTITUTION_SUMMARY`
  (`prisma/schema.prisma:1158`); only the student report is assembled.
- The `Report` model (`prisma/schema.prisma:1164`, with `fileUrl`) has **zero
  references** anywhere in `src/` — no row is ever written or read.

**Done when:** a decision is recorded on rendering (client-side only vs. server-side
puppeteer/pdfkit) and on storage (`Report.fileUrl` → which bucket). If server-side is
chosen: a render endpoint, a persisted `Report` row per generation, and the parent /
institution variants of the assembler. If client-side stays, the unused model and enum
should be dropped or explicitly documented as reserved.

**Size:** large. Blocked on a product/infra decision — do not start without it.

**Decisions taken:** PDF rendering **stays client-side** — no server-side render
endpoint, so nothing generates a file and nothing needs object storage. **Student report
only** — the parent and institution variants are not being built now.

**What landed:** documentation of the decision, so the schema stops implying a pipeline
that doesn't exist:

- `prisma/schema.prisma` — `Report` marked RESERVED/unused, `ReportType` noting that only
  `STUDENT_CAREER_PATH` has an assembler. Comment-only, **no migration**.
- `docs/db-design.md` §`Report` rewritten from "Generated PDF outputs" to reserved/unused;
  `docs/frontend-integration-guide.md` §13 now states client-side PDF is the decision (so
  the frontend owns the print view permanently, rather than waiting on the backend);
  `CLAUDE.md` moves this from "not implemented" to "decided".

**Deliberately not done:** the `Report` table and the two unused `ReportType` values were
**kept, not dropped**. They're the shape a server-side renderer would persist, and the
variants are "not yet" rather than "never" — dropping them would be churn on a decision
that may be revisited. If you'd rather they go, it's a one-line schema deletion plus a
migration (the table has never held a row).

**If this is ever revisited**, the original analysis stands: pick puppeteer (fidelity,
but Chromium doesn't run on Vercel serverless without work — see `docs/deploy-vercel.md`)
or pdfkit (deploys anywhere, but the layout gets rebuilt in primitives and drifts from
the web view).

---

## 2. Deliberate deferrals — recorded, no action unless priorities change

- **No canonical-lookup-row edit endpoint** in Career Library. Inline "add new" takes the
  full canonical field set and **blank-fills** an existing row rather than overwriting it;
  there is deliberately no endpoint for editing an exam/course/college row directly.
- **No `Project` ↔ `Cohort` link and no `Student.cohort`.** This is the real multi-cohort
  work (students must carry a cohort, since forms and assessments are cohort-specific).
  Deferred until a second cohort is actually onboarded.
- **No FKs on cohort columns** — `FormTemplate.cohort`, `AssessmentQuestion.cohort` and
  `AssessmentAttempt.cohort` stay plain strings matching `Cohort.code`. The table is a
  decoupled source of truth; converting to relations is deferred. Recorded in both
  `docs/db-design.md` and the schema comment.
- **OpenAPI spec is hand-maintained** (`src/config/openapi.ts`) — every new route needs a
  matching `registry.registerPath(...)`. Generating it from the routes would stop the
  drift but is not required.

---

## 3. Doc drift to fix

**Status:** [x] DONE — 2026-08-30. `CLAUDE.md` and `notes.md` corrected; the
frontend guide's "no scheduler/cron" bullet replaced with the real story (built, but off
unless `SCHEDULER_ENABLED=true`, and no manual trigger endpoint). Kept below as the record
of what was wrong.

These described the codebase as it was, not as it is:

- `notes.md` lists the reminder scheduler as pending. It is **built** — `src/scheduler/`
  runs node-cron behind `SCHEDULER_ENABLED` with both jobs (same-day session reminders,
  follow-up nudges) and send-side idempotency stamps.
- `CLAUDE.md:80` says stages beyond `SESSION_2_COMPLETED` "depend on modules that don't
  exist yet (Counsellor Chart/Feedback, Reports)". All three modules now exist
  (`src/modules/counsellor-chart/`, `src/modules/feedback/`, `src/modules/reports/`) —
  the real reason the stages don't advance is item 1.2, not missing modules.
- `CLAUDE.md:151` lists "a scheduler/cron for automatic same-day/nudge reminders" under
  **Not yet implemented**. Same as above — it is implemented.

---

## 4. Found along the way

- **Two modules were missing from the OpenAPI spec entirely** — counsellor-chart (5
  routes) and feedback (2 routes) had no `registry.registerPath(...)`, so they never
  appeared in Swagger. Fixed as part of 1.2. Worth a periodic audit: the spec is
  hand-maintained, and nothing fails when a route is forgotten.
- **Report access is not gated on feedback completion.** `docs/db-design.md` records an
  unresolved source-doc conflict: one spec gates report *generation* on both student and
  parent feedback, another gates only the *download* on parent feedback. Today
  `GET /reports/students/{id}/assessment` is gated on neither — it resolves as soon as the
  assessment is scored. That's now load-bearing, because 1.2 made the student's own fetch
  the `CLOSED` trigger (guarded so an early fetch can't skip stages, but it does mean a
  student can read their report before feedback is in). Worth confirming with PWC whether
  the report should be withheld until the feedback pair is submitted.

---

## Suggested order

1. ~~**1.1**~~ — done.
2. ~~**1.2**~~ — done.
3. ~~**Section 3**~~ — done (drift fixed in `CLAUDE.md` and `notes.md`).
4. ~~**1.3**~~ — closed by decision (client-side PDF, student report only); nothing to build.

Everything on this list is now either done or closed by decision. The open threads left
are the two items in §4 and the deferrals in §2.
