---
name: assessment-qa
description: QA and verify the Class 9 & 10 assessment scoring engine — inspect the computed report for a given answer pattern, run the scoring tests, and re-import the weight tables. Use when the user wants to check assessment logic, test scoring, debug a trait/stream/career result, or update the assessment reference data.
---

# Assessment scoring QA

The scoring engine is under `src/modules/assessment/scoring/` — **pure
functions** over a normalized attempt, orchestrated by `index.ts`
(`scoreAssessment`). No DB, no auth in the engine itself. Reference tables live
in `scoring/data/*.ts`; scoring config (grade bands, reverse keys, mirror
pairs, tie-breaks) in `scoring/config.ts`.

## Fastest way to eyeball a report: the dev tester

A single self-contained page drives the engine end-to-end with quick-fill
buttons — no student/attempt/DB setup.

```bash
pnpm dev
```

Open **http://localhost:4000/dev/assessment** (served only when
`NODE_ENV !== production`; source: `public/assessment-tester.html`). Log in with
a **staff** account, **Load questions**, **Fill Likert / Randomise**, **Score it**.
It renders every section: DCS/DPS, the four trait layers with grades, Stream Fit,
Graduation Pathways, Career Fit (top-6 domains + representative careers),
reliability, and a raw-JSON drawer.

Behind it: `POST /api/v1/assessment/score-preview` (staff-only, **no
persistence**):

```jsonc
// body — partial OK: unanswered Likert defaults to neutral, aptitude to incorrect
{ "cohort": "CLASS_9_10", "durationMinutes": 30,
  "answers": [ { "fieldKey": "riasec_realistic_r1", "response": "5" }, ... ] }
```

`response` is the raw Likert value `"1".."5"` or MCQ letter `"A".."E"`.
`durationMinutes` drives the ORI (completion-time) band.

## Run the scoring tests

```bash
npx vitest run test/assessment-scoring.test.ts     # per-layer + orchestrator (pure)
npx vitest run test/assessment-preview.test.ts     # the score-preview endpoint
npx vitest run test/assessment-submission.test.ts  # full attempt → stored result
```

`assessment-scoring.test.ts` is the place to add cases when tuning the engine —
it builds profiles directly and asserts scores/grades/tie-breaks without HTTP.

## Things to check when a result looks wrong

- **Fit qualifying threshold** — Stream/Career/Graduation recommendations drop
  anything below the "Good Fit" floor (`FIT_QUALIFYING_MIN = 60` in `config.ts`).
  A short `top3`/`top6` (even empty) is expected, not a bug. The full unfiltered
  list is in `ranked`/`rankedDomains`.
- **Reverse-keyed items** (`REVERSE_KEYED_CODES`) — trait % uses `6 - response`;
  RVS uses the raw punched value.
- **Mirror pairs** (`MIRROR_PAIRS`) — drive RVS (sum model, `rvs.ts`). Uniform
  answering (all same value) legitimately floors RVS — that's the check working.
- **Tie-breaks** — Step 1 (fewer neutrals / higher DC for aptitude) then the
  fixed `TIEBREAK_ORDER`.
- **ARI** — `dc` is always present; `tc`/`ari` are `null` until the frontend
  sends per-question `timeTakenMs` (a known pending item, not a bug).
- **Aptitude** — needs `correctOption` (never exposed via the public
  `GET /questions`). Random answers ⇒ low aptitude, which is correct.

## Re-import the weight tables

Weights/trait tables come from an Excel workbook. To regenerate after the
workbook changes:

```bash
python3 scripts/export-assessment-scoring.py   # docs/…Traits Weightages…xlsx → scoring/data/*.ts
```

Output is emitted as **`.ts`** (not JSON) so it compiles into `dist/` and is
available at runtime — see `scoring/data/types.ts` for the shapes
(`riasec-120.ts`, `bigfive-20.ts`, `stream-weights.ts`, `domain-weights.ts`,
`graduate-streams.ts`, `trait-definitions.ts`). Re-run `pnpm test` after.

## Full-flow QA (with persistence)

Create student → `POST /assessment/attempts` → `PUT …/answers` → `POST
…/submit` (scores + stores) → `GET …/result` or the assembled report
`GET /reports/students/{id}/assessment`. Note the attempt routes require a
student-or-staff token **and** ownership (a student only their own).
