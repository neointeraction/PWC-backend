# Database Design

Source of truth is [`prisma/schema.prisma`](../prisma/schema.prisma) — this document
explains the model, relationships, and open questions in one place. Regenerate/update
this doc whenever the schema changes meaningfully.

## Entity overview

```
Institute (tenant)
 ├─ InstituteClass ─ InstituteDivision ─┐
 ├─ Counsellor ── ProjectCounsellor ─┐  │
 └─ Project (counselling cycle)     │  │
       ├─ Student ─────────────────┴──┘
       ├─ CounsellorAvailability
       └─ ProjectCounsellor

Student
 ├─ User (1:1, role=STUDENT)
 ├─ Session (x2: SESSION_1, SESSION_2)
 ├─ FormSubmission (profile / pre-counselling / feedback)
 ├─ AssessmentAttempt → AssessmentResult
 ├─ CounsellorChart (1:1)
 └─ Report (x N: student career path, parent summary, institution summary)

Counsellor
 ├─ User (1:1, role=COUNSELLOR)
 ├─ CounsellorAvailability (per project)
 ├─ ProjectCounsellor (assigned projects)
 ├─ Session (as the assigned counsellor)
 └─ CareerLibraryRequest (submitted by)

CareerLibraryEntry ← CareerLibraryRequest (ratification workflow)
```

## Why `Project` sits between `Institute` and `Student`

An `Institute` is the permanent tenant record (a school). A `Project` is one dated
counselling cohort/cycle run for that institute (e.g. "2026 Batch, Class 9–10"), with
its own student roster and its own assigned counsellors. Closing a `Project`
(`status = CLOSED`) is the data-retention/purge boundary described in the functional
spec — everything hanging off a `Student` (forms, assessment, sessions, chart, reports)
is scoped to that student's single `Project`, so purging a closed project purges its
full downstream graph via cascading deletes.

A `Student` therefore belongs to exactly one `Project`, not directly to an `Institute` —
the institute is reached via `Student → Project → Institute`. Class/division structure
(`InstituteClass` / `InstituteDivision`) is a property of the institute itself, not the
project, since the same class/division taxonomy is reused across an institute's cohorts.

## Tables

### `User`
Login identity shared by all roles. `Student` and `Counsellor` extend it 1:1;
`ADMIN`/`SUPER_ADMIN` rows have no extension table (no domain-specific fields beyond
the base user yet).

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| email | String | unique |
| passwordHash | String | argon2 |
| role | `UserRole` enum | STUDENT / COUNSELLOR / ADMIN / SUPER_ADMIN |
| firstName, lastName | String | |
| isActive | Boolean | default true |
| mustChangePassword | Boolean | default true; forces reset on first login (Student and Counsellor both get admin-generated temp passwords) |
| createdAt, updatedAt | DateTime | |

### `RefreshToken`
Hashed refresh tokens, one row per active session, revocable individually.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| tokenHash | String | unique |
| userId | String | FK → User, cascade delete |
| expiresAt | DateTime | |
| revokedAt | DateTime? | null while active |

### `Institute`
The tenant. Onboarded by Super Admin.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| name | String | unique |
| address | String | |
| contactNumber | String | unique, E.164 |
| primaryEmail | String | unique |

### `InstituteClass` / `InstituteDivision`
Institute-defined class/division taxonomy (e.g. "Grade 10" → "A", "B"). Free text,
institute-scoped, not a global enum.

`InstituteClass`: `id, name, instituteId (FK, cascade)`, unique on `(instituteId, name)`.
`InstituteDivision`: `id, name, classId (FK, cascade)`, unique on `(classId, name)`.

### `Project`
A counselling cycle/cohort under an institute.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| instituteId | String | FK → Institute, cascade delete |
| name | String | unique per institute |
| fromDate, toDate | DateTime | cohort duration |
| status | `ProjectStatus` enum | ACTIVE / CLOSED |

### `Counsellor`
Extends `User` (role=COUNSELLOR). Belongs to exactly one institute; assigned to
specific projects via `ProjectCounsellor`.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| userId | String | FK → User, unique, cascade delete |
| instituteId | String | FK → Institute |
| mobile | String | unique, E.164 |

### `ProjectCounsellor`
Join table: which counsellors are assigned to which project. Unique on
`(projectId, counsellorId)`.

### `CounsellorAvailability`
Recurring weekly availability window, **scoped per project** — the same counsellor can
have different hours on different projects.

| Field | Type | Notes |
|---|---|---|
| counsellorId | String | FK → Counsellor |
| projectId | String | FK → Project |
| daysOfWeek | `Weekday[]` | native Postgres array (MON..SUN) |
| startTime, endTime | String | "HH:mm", 24h |

### `Student`
Extends `User` (role=STUDENT).

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| userId | String | FK → User, unique, cascade delete |
| studentCode | String | unique; admin-generated login id, e.g. "CB1" |
| projectId | String | FK → Project, cascade delete |
| divisionId | String | FK → InstituteDivision |
| mobile | String | unique, E.164 |
| whatsappNumber | String? | optional, only if different from mobile |
| parentMobile | String | unique, E.164; primary contact for session links/notifications (Student Profile Form, Section A) |
| parentEmail | String | unique; primary contact, same as above |
| fatherName, fatherOccupation | String | Student Profile Form, Section B |
| fatherEmployer | String? | optional ("if applicable") |
| motherName, motherOccupation | String | Student Profile Form, Section C |
| motherEmployer | String? | optional ("if applicable") |
| workflowStatus | `WorkflowStatus` enum | see lifecycle below |

Earlier revisions of this schema had a single `parentName` field (matching the
institute's bulk-upload Excel columns). The Student Profile Form — filled by the
student after first login, before the pre-counselling form — turned out to capture
father and mother details **separately** (name, occupation, employer each), so
`parentName` was replaced with the six fields above. `parentMobile`/`parentEmail`
remain single fields — the profile form only asks for one "PRIMARY" mobile/email pair,
not one per parent, confirming the single-primary-contact model.

Unlike the other forms, this content was modeled as first-class `Student` columns
rather than through the generic `FormTemplate`/`FormQuestion` engine — it's queryable
master data about the student (like `parentMobile`/`parentEmail` already were), not
a survey response to reference verbatim later. `FormType.STUDENT_PROFILE` remains in
the enum for any non-core profile questions that might surface later, but has no
seeded content since everything captured so far maps to real columns.

**Status lifecycle** (`WorkflowStatus`): `DRAFT → PROFILE_COMPLETED →
PRE_COUNSELLING_FORMS_SUBMITTED → ASSESSMENT_PENDING → ASSESSMENT_COMPLETED →
SESSION_SCHEDULED → SESSION_1_COMPLETED → COUNSELLOR_FEEDBACK_REPORT →
SESSION_2_COMPLETED → COUNSELLOR_FEEDBACK → STUDENT_PARENT_FEEDBACK → CLOSED`

### `Session`
One row per counselling session (max 2 per student: `SESSION_1`, `SESSION_2`).
Session 1 is booked **blind** — the student picks an open slot without seeing whose it
is, and `counsellorId` is derived from the slot owner at booking time. Session 2 must
reuse the same `counsellorId` as Session 1 (enforced in the service layer, not the DB).

| Field | Type | Notes |
|---|---|---|
| studentId | String | FK → Student, cascade delete |
| counsellorId | String | FK → Counsellor |
| sessionNumber | `SessionNumber` enum | SESSION_1 / SESSION_2 |
| scheduledDate | Date | |
| startTime, endTime | String | "HH:mm" |
| status | `SessionStatus` enum | SCHEDULED / COMPLETED / RESCHEDULED / CANCELLED |
| notes | String? | counsellor's session notes/agenda |
| cancellationReason | `CancellationReason`? | STUDENT_UNAVAILABLE / COUNSELLOR_UNAVAILABLE / INSTITUTION_REQUEST / OTHER |
| cancellationNotes | String? | free text |
| rescheduledFromDate, rescheduledFromStart | nullable | prior date/time, for the "was X → now Y" display |

Unique constraints: `(studentId, sessionNumber)` — a student can't double-book the same
session number; `(counsellorId, scheduledDate, startTime)` — prevents double-booking a
counsellor's slot.

### `CareerLibraryEntry`
Central, PWC-owned career database. Populated from `Career Library_Updated_0508.xlsx`
("CL" tab) — 1,317 rows imported via `scripts/export-career-library.py` +
`prisma/seed-data/career-library/`. See "Career Library workbook import" below for
the full import design and cross-table mapping.

| Field | Type | Notes |
|---|---|---|
| cluster, industry, domain, jobRole | String | classification |
| aiResilienceGrade | `AiResilienceGrade` enum | LOW / MEDIUM / HIGH / VERY_HIGH (source only uses the first three) |
| aiResilienceComment | String | justifies the grade |
| oneLineDescription | String | |
| topCompanies | String[] | tag-style multi-value |
| salaryIndiaRangeText | String? | raw source text, e.g. "₹6–25 LPA" (kept — source has non-numeric ranges like "0–Limitless") |
| salaryIndiaMinLPA, salaryIndiaMaxLPA | Float? | best-effort parse of the above; null when unparseable |
| salaryGlobalRangeText | String? | raw source text, e.g. "$70k–$160k" |
| salaryGlobalMinUSD, salaryGlobalMaxUSD | Float? | best-effort parse (in USD, not $k); null when unparseable |
| qualification10th12th | String | required |
| qualificationGraduation, qualificationPG | String? | source has 3 distinct qualification levels, not 1 |
| entranceExamsUGDescription | String? | full descriptive text from the source |
| entranceExams | String[] | UG level, cleaned/short exam names — join key against `UgEntranceExam.examName` |
| entranceExamsPG | String[] | PG level |
| certificationsStudent, certificationsUG | String[] | source distinguishes pre-UG vs. during-UG certification recommendations |
| topCourses | String[] | tag-style multi-value |
| status | `CareerLibraryStatus` enum | DRAFT / ACTIVE |
| createdBy, updatedBy | String | User id, or `"seed:career-library-import"` for bulk-imported rows |

### `CareerLibraryRequest`
Counsellor-submitted request to add an unlisted career; reviewed by Admin/Super Admin
before becoming a permanent `CareerLibraryEntry`.

| Field | Type | Notes |
|---|---|---|
| requestedById | String | Counsellor id |
| jobTitle, suggestedCluster, suggestedIndustry | String | |
| suggestedDomain | String? | optional |
| oneLineDescription, justification | String | |
| referenceLinks | String[] | optional sources |
| status | `CareerRequestStatus` enum | PENDING / APPROVED / REJECTED |
| reviewedBy, reviewedAt | nullable | who approved/rejected, when |
| resultingEntryId | String? | FK → CareerLibraryEntry, once approved |

### Career Library workbook import — UG/PG reference tables

`Career Library_Updated_0508.xlsx` has 8 tabs; the last (`Post-12_Entrance_Exams__India__`)
is out of scope per instruction and was not imported. The other 7 tabs each map to
exactly one table — no FK relations to `CareerLibraryEntry` or to each other; they're
matched **by value** at query time, not by foreign key:

| Workbook tab | Table | Rows | Join key → `CareerLibraryEntry` |
|---|---|---|---|
| CL | `CareerLibraryEntry` | 1,317 | (the hub table) |
| UG Institutions_IND | `UgInstitution` | 702 | `industry` ↔ `CareerLibraryEntry.industry` |
| UG Inst+Uty_IND | `UgInstitutionUniversity` | 34 | none (general directory, not industry-mapped) |
| UG Entrance_IND | `UgEntranceExam` | 109 | `examName` ↔ `CareerLibraryEntry.entranceExams` (UG, extracted) |
| UG Courses_IND | `UgCourse` | 67 | `careerCluster` ↔ `CareerLibraryEntry.cluster` |
| PG Institutions_IND | `PgInstitution` | 1,368 | none (not requested; `industry` field kept but unmapped) |
| PG Entrance_IND | `PgEntranceExam` | 29 | none (not requested) |

Each new table mirrors its source tab's columns close to 1:1 (see `prisma/schema.prisma`
for the full field list — mostly optional `String` columns, since this is reference
data, not something the app writes to).

**Import pipeline**: `scripts/export-career-library.py` (Python, one-off — not part of
the app runtime) reads the workbook with `openpyxl`, cleans/splits list-like columns
(`,`-separated for most, `;`-separated for the two certification columns), best-effort
parses salary ranges, and writes one JSON file per tab to
`prisma/seed-data/career-library/`. `prisma/seed-data/career-library/index.ts` loads
those JSON files and is called from `prisma/seed.ts` — it **clears and reinserts**
(`deleteMany` + `createMany`) rather than upserting, since these rows have no natural
per-row unique key and the whole dataset is meant to be replaced on reimport. Rerun the
Python script and `pnpm db:seed` if the source workbook changes.

**Cross-table mapping — verified, not enforced.** These are plain string-equality
matches (e.g. `WHERE industry = ?`), not database constraints, per instruction. Before
seeding, two real spelling/naming mismatches in the source data were found and
corrected in the export script (`INDUSTRY_ALIASES`, `EXAM_ALIASES` in
`scripts/export-career-library.py`) so the joins resolve cleanly:
- `UG Institutions_IND` uses `"Defense"` (American spelling, 12 rows) where CL uses
  `"Defence"` — normalized to `"Defence"` on import.
- CL's extracted UG exam list uses the token `"CUET"` (1,055 `CareerLibraryEntry` rows)
  where `UG Entrance_IND` names the exam `"CUET UG"` — normalized to `"CUET UG"` on
  import.

After these fixes, mapping coverage is 100%: every `CareerLibraryEntry.industry` value
has at least one matching `UgInstitution` row, every extracted UG exam token matches a
`UgEntranceExam.examName`, and every `CareerLibraryEntry.cluster` value matches at
least one `UgCourse.careerCluster`.

### Forms — `FormTemplate` / `FormQuestion` / `FormSubmission` / `FormAnswer`

JSON-driven rather than fixed columns, so one shared rendering/submission engine can
serve every form and cohort while content stays data (not schema). Real content for
four form types is now seeded (`prisma/seed-data/forms/`, loaded by `prisma/seed.ts`):
`PRE_COUNSELLING_STUDENT`, `PRE_COUNSELLING_PARENT`, `FEEDBACK_STUDENT`,
`FEEDBACK_PARENT`. `STUDENT_PROFILE` has no seeded content because its actual content
turned out to be first-class `Student` columns rather than generic form questions —
see the `Student` table section above.

- `FormTemplate`: `formType` (`FormType` enum: STUDENT_PROFILE / PRE_COUNSELLING_STUDENT
  / PRE_COUNSELLING_PARENT / FEEDBACK_STUDENT / FEEDBACK_PARENT), cohort, version,
  isActive`. Unique on `(formType, cohort, version)`.
- `FormQuestion`: one row per numbered question on the source form (`questionCode`, e.g.
  "Q1"; `fieldKey`, matching the source HTML's `name` attribute). `questionType` is
  `MCQ_SINGLE` / `MCQ_MULTI` / `SHORT_TEXT` / `OPEN_TEXT` / `NUMBER` / `SCALE` / `MATRIX`.
  Table/grid-style questions (e.g. the academic marks table, the 18-row strengths rating
  grid) are kept as a **single** `MATRIX` row rather than exploded per cell — `options`
  holds `{ rows?: [...], fields: [...] }` describing the grid shape, and the submitted
  answer is one Json object keyed by each sub-field, so the question still renders and
  reports as the original numbered item. `allowOtherText` / `otherTextFieldKey` link an
  MCQ's "Any Other: ___" choice to its free-text field. Unique on
  `(formTemplateId, fieldKey)` and on `(formTemplateId, order)` — the latter guarantees
  a single, unambiguous render order per form/cohort and can't collide across cohorts,
  since each cohort gets its own `FormTemplate` row.
- `FormSubmission`: one per `(studentId, formTemplateId, submittedByRole)`. This is the
  save point for **both** the candidate's and the parent's answers — `submittedByRole`
  (`STUDENT` / `PARENT`) distinguishes them, and since parents have no login, their
  submission is still recorded against the student's `studentId`. In practice each form
  type is filled by exactly one role (e.g. `PRE_COUNSELLING_PARENT` is always `PARENT`),
  so `submittedByRole` is currently redundant with `formType` — kept explicit for
  clarity and in case a form type ever needs to be fillable by either role.
- `FormAnswer`: one per `(submissionId, questionId)`, `answer` as Json (a single value
  for most types, the full keyed object for `MATRIX` questions).

Respondent header fields shown on the source forms (student name/code, counsellor name,
date, parent name) are **not** stored as `FormQuestion`/`FormAnswer` rows — they're
derivable from `FormSubmission.studentId` / `submittedAt` and the student's assigned
counsellor, so storing them again would be redundant.

### Assessment — `AssessmentQuestion` / `AssessmentAttempt` / `AssessmentAnswer` / `AssessmentResult`

Real content is seeded for cohort `CLASS_9_10` (`prisma/seed-data/assessment/class9to10.ts`):
73 questions across four sections — RIASEC interest inventory (24, Likert), Big Five
personality (20, Likert), Aptitude reasoning (20, single-correct MCQ with
difficulty/weight), and Cognitive & Decision Style (9, Likert). PWC's proprietary
scoring/weighting logic for trait aggregation and career-stream mapping is still
pending — only the per-question `weight` and `difficulty` tags present in the source
form are captured.

**`correctOption` is intentionally left unset for every aptitude question.** The source
form doesn't mark correct answers, and guessing them would silently bake a possibly-wrong
answer key into real student scoring — PWC needs to supply/confirm the official key
before these can be auto-graded.

- `AssessmentQuestion`: `cohort, section` (`AssessmentSection`: RIASEC / BIG_FIVE /
  APTITUDE / COGNITIVE), `questionCode, fieldKey, questionText, format`
  (`AssessmentQuestionFormat`: LIKERT_5 / MCQ_SINGLE), `options` (Json, MCQ_SINGLE only),
  `trait, traitCode` (e.g. "REALISTIC"/"R1", "NUMERICAL"/"NR1"), `difficulty`
  (aptitude only), `weight`, `correctOption` (aptitude only, currently unset). Unique on
  `(cohort, fieldKey)` and on `(cohort, order)` — same reasoning as `FormQuestion`: a
  future cohort (e.g. Class 11-12, with its own question count per the FSD) gets its
  own `cohort` value and its own independent order sequence.
- `AssessmentAttempt`: one per student attempt, `status` (IN_PROGRESS / SUBMITTED),
  `startedAt, submittedAt`.
- `AssessmentAnswer`: one per `(attemptId, questionId)`, `selectedOption` as Json (a
  Likert value 1-5, or an MCQ option letter).
- `AssessmentResult`: 1:1 with an attempt, `traitScores` (Json map of trait → score),
  `recommendedStreams` (String[]), `summary`.

### `CounsellorChart`
Auto-generated on assessment completion (aggregating pre-counselling + parent
responses + assessment result), then live-edited by the assigned counsellor during
sessions. 1:1 with `Student`.

| Field | Type | Notes |
|---|---|---|
| strengths, hobbies | String[] | counsellor-edited during sessions |
| careerShortlist | String[] | narrowed from 6 → 2 across Session 1 → Session 2 |
| rawData | Json | snapshot of pre-counselling + parent + assessment data |
| lastEditedBy | String? | Counsellor id |

Exact editable field shape is provisional — pending the actual Counsellor Chart
template from PWC.

### `Report`
Generated PDF outputs. One student can have multiple report rows (different
audiences).

| Field | Type | Notes |
|---|---|---|
| studentId | String | FK → Student, cascade delete |
| generatedByCounsellorId | String | Counsellor id |
| type | `ReportType` enum | STUDENT_CAREER_PATH / PARENT_SUMMARY / INSTITUTION_SUMMARY |
| fileUrl | String | object storage location |
| generatedAt | DateTime | |

## Deliberate scope gaps (not modeled yet)

- **Assessment scoring/weighting logic** — PWC's proprietary rules for turning trait
  scores into recommended career streams aren't supplied; `AssessmentResult.traitScores`
  /`recommendedStreams` exist as storage but nothing computes them yet. Aptitude
  `correctOption` is also unset for the same reason (see Assessment section above).
- **Institution subscription fields** (renewal date, seats, career-library-sync status)
  — mentioned in the functional spec but no concrete field list supplied yet.
- **Notification log** — email/reminder delivery isn't persisted; sending is treated as
  a side effect, not a DB record, for now.
- **Audit log** (chart edits, report access, admin approvals) — a cross-cutting
  security requirement from the spec, not yet modeled as a table.
- **Slot materialization** — `Session` booking is blind (counsellor derived from the
  chosen slot), but available slots are computed on the fly from
  `CounsellorAvailability` minus existing `Session` rows, rather than a persisted slot
  inventory table.

## Known conflicts between source documents (unresolved)

These came from comparing the original Functional Specification Document against the
later Prompt Engineering Doc — flagged for confirmation, not yet reflected as a schema
decision either way:

1. **Session booking flow**: earlier doc describes truly blind booking with the
   counsellor assigned from the slot; a later wireframe shows the counsellor already
   named before slot selection, with Session 1 and Session 2 picked together in one
   step. Current schema/service assumes blind booking (see above) — confirmed via a
   direct question, but the wireframe still visually contradicts it.
2. **Report/download gating**: one doc gates report *generation* on both student and
   parent feedback; another gates only the *download* action on parent feedback
   specifically, with no mention of student feedback gating anything.
3. **Career Library media attachments** (banner image, PDF roadmap) appear in one
   admin mockup but aren't in the documented field list for `CareerLibraryEntry`.

## Data retention

All data under a `Project` (students, forms, assessments, sessions, chart, reports) is
purged once that project is marked `CLOSED`. Cascading deletes are wired so that
deleting a `Project` (or a `Student` within it) cleans up everything downstream. No
fixed retention window is modeled per-institute yet — if an institute's contract
requires a delay before purge, that would need a `retentionDays`-style field on
`Institute`, not yet added.
