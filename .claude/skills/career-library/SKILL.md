---
name: career-library
description: Work with the career library module — browse/search entries, add or edit entries (DRAFT→ACTIVE publish), the counsellor ratification-request flow, the cross-table UG/PG mapping, and re-importing the source workbook. Use when the user wants to manage career entries, debug career data, or update the library from its spreadsheet.
---

# Career Library

Central, PWC-owned library of ~1,300 career roles (`CareerLibraryEntry`), plus
related UG/PG institution, course, and entrance-exam reference tables. Module:
`src/modules/career-library/`. The same trait data also feeds **Career Fit** in
the assessment (see below).

## Data model

`CareerLibraryEntry` — `cluster / industry / domain / jobRole`,
`aiResilienceGrade` (`LOW|MEDIUM|HIGH|VERY_HIGH`), salary text + parsed
min/max, `qualification10th12th / Graduation / PG`, entrance exams,
certifications, `topCompanies / topCourses`, and `status` (`DRAFT|ACTIVE`).
`CareerLibraryRequest` — counsellor-submitted proposals to add a career
(`PENDING → APPROVED|REJECTED`).

## Reads (any authenticated user)

- `GET /api/v1/career-library` — search/list (`search`, `cluster`, `industry`,
  `domain`, `aiResilienceGrade`, `status` [default `ACTIVE`], pagination).
- `GET /api/v1/career-library/filters` — distinct clusters/industries/domains.
- `GET /api/v1/career-library/{id}` — one entry **plus cross-referenced**
  `relatedInstitutions` / `relatedCourses` / `relatedEntranceExams`. This
  mapping is by **plain value match** (industry / cluster / exam-name), not FKs
  — see `getCareerLibraryEntryById`.

## Writes (admin) and the DRAFT→ACTIVE publish step

- `POST /career-library` — create. **Defaults to `DRAFT`**, which is hidden from
  the default (ACTIVE-only) list. `createdBy` = calling admin.
- `PATCH /career-library/{id}` — update; **set `status: "ACTIVE"` to publish**
  (this is the "ratify"/publish action). Sets `updatedBy`.
- `DELETE /career-library/{id}` — detaches any request's `resultingEntryId`
  first, then deletes.

### Normalized "select existing or add new" links

Entrance exams, courses, and institutions/colleges are **canonical lookup tables**
(`EntranceExam`/`Course`/`Institution`) linked to each career many-to-many. On
create/update, `entranceExams` / `courses` / `institutions` each take
`[{ id } | { name, … }]` — existing rows by id, new ones find-or-created by name (exam
items need `level` UG/PG when added by name). A provided array **replaces** that entry's
links; the old `String[]` columns are dual-written during the transition. Feed the
dropdowns from `GET /career-library/{entrance-exams,institutions,courses}?search=&level=`.
`GET /career-library/{id}` returns curated `linkedEntranceExams`/`linkedCourses`/
`linkedInstitutions` plus the legacy `related*` value-match view. Design + backfill:
`docs/career-library-normalization-spec.md`, `prisma/seed-data/career-library/normalize.ts`.

## Ratification flow (counsellor proposes → admin reviews)

- `POST /career-library/requests` (staff) — a counsellor's `requestedById` is
  resolved from their token; an admin filing on behalf passes it explicitly.
- `GET /career-library/requests` + `/{requestId}` (staff) — list/detail.
- `POST …/{requestId}/approve` (admin) — `{ resultingEntryId? }` links the entry
  the admin created from it. 409 if already reviewed.
- `POST …/{requestId}/reject` (admin).

Approve does **not** auto-create an entry — the request's sparse fields can't
populate a full entry. The admin creates the entry via `POST /career-library`
and links it on approve.

## Link to assessment Career Fit

Career Fit matches the 18-trait profile against per-`(industry, domain)` weights
in `src/modules/assessment/scoring/data/domain-weights.ts`, and the service
resolves a **representative career** (highest AI-resilience role) from this
library. If a career/industry is missing from Fit results, check both the entry
exists **and** the weight row exists for its industry/domain. See the
`assessment-qa` skill for scoring QA.

## Re-import from the source workbook

```bash
python3 scripts/export-career-library.py   # all tabs of "docs/Career Library_Updated_1808.xlsx" → *.json
pnpm db:seed                                # loads the JSON via prisma/seed.ts
```

All tabs are exported from `docs/Career Library_Updated_1808.xlsx`. The CL tab carries
the yellow columns (`roleOverview`, `keySkills`, `qualification10th12thExplanation`, and
the `*Defined` qualification variants). Note 1808's `UG Institutions_IND` tab dropped two
columns vs. the older 0508 workbook, so `UgInstitution.programmesOfferedAfterClass12` /
`keyProgrammesOffered` are exported as null. Each exporter's column indices match 1808;
re-check them if the workbook layout changes again.

Unlike the assessment reference data (`.ts`), the library is seeded **into the
database** as JSON, so a re-import needs a re-seed, not just a rebuild.

## Tests

```bash
npx vitest run test/career-library.test.ts         # reads / search / cross-table mapping
npx vitest run test/career-library-writes.test.ts  # create/publish/delete + ratification
```

Writes/ratification are role-gated — tests use `authRequest(app)` (admin) and a
real counsellor token (`bearer("COUNSELLOR", { userId })`) for the request flow.
