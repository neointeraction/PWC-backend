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
       ├─ CounsellorSlot
       └─ ProjectCounsellor

Student
 ├─ User (1:1, role=STUDENT)
 ├─ Session (x2: SESSION_1, SESSION_2) ── CounsellorSlot (1:1, the slot it consumed)
 ├─ FormSubmission (profile / pre-counselling / feedback)
 ├─ AssessmentAttempt → AssessmentResult
 ├─ CounsellorChart (1:1)
 └─ Report (x N: student career path, parent summary, institution summary)

Counsellor
 ├─ User (1:1, role=COUNSELLOR)
 ├─ CounsellorSlot (per project — discrete bookable slots)
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
Hashed refresh tokens, one row per active session, revocable individually. Written by
`src/modules/auth/auth.service.ts` — `tokenHash` is a SHA-256 digest of the opaque
random token handed to the client in an httpOnly cookie (the raw token itself is never
persisted). `POST /auth/refresh` rotates: the presented token's row gets `revokedAt`
set and a new row is created, so a stolen-then-reused refresh token fails on its second
use. `POST /auth/logout` just sets `revokedAt` on the current row.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| tokenHash | String | unique, SHA-256 of the raw token |
| userId | String | FK → User, cascade delete |
| expiresAt | DateTime | `now() + JWT_REFRESH_EXPIRES_IN` at issue time |
| revokedAt | DateTime? | null while active; set on refresh (rotation) or logout |

### `PasswordResetToken`
Hashed, single-use password-reset tokens for the forgot-password flow. Written by
`src/modules/auth/auth.service.ts` — like `RefreshToken`, only the SHA-256 `tokenHash` is
stored; the raw token lives only in the emailed `${APP_WEB_URL}/reset-password?token=...`
link. `POST /auth/reset-password` consumes a row (sets `usedAt`); expired or already-used
tokens are rejected. A password change or reset also revokes all of the user's
`RefreshToken` rows.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| tokenHash | String | unique, SHA-256 of the raw token |
| userId | String | FK → User, cascade delete |
| expiresAt | DateTime | `now() + PASSWORD_RESET_EXPIRES_IN` (default 1h) at issue time |
| usedAt | DateTime? | null while unused; set when the token is consumed (single-use) |

### `Cohort`
Read-only lookup of counselling cohorts, to populate cohort dropdowns (`GET /cohorts`).
Deliberately **decoupled** from the cohort-scoped content: `FormTemplate.cohort`,
`AssessmentQuestion.cohort` and `AssessmentAttempt.cohort` stay plain strings that *match*
`Cohort.code` by convention, **not** FKs — this avoids a large migration while there's a
single cohort. Only `CLASS_9_10` exists today; managed via `prisma/seed.ts` (no CRUD API).
Linking a `Project` (or `Student`) to a cohort is deferred until a second cohort is onboarded.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| code | String | unique, e.g. `CLASS_9_10` — the join key to cohort-scoped content |
| name | String | human label, e.g. "Class 9 & 10" |
| isActive | Boolean | default true; `GET /cohorts` returns active only |
| displayOrder | Int | default 0; dropdown ordering |

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
| status | `ProjectStatus` enum | ACTIVE / CLOSED / DELETED (DELETED = reversible soft-delete via `DELETE` + `PATCH /:id/restore`; hidden from default listings) |

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

### `CounsellorSlot`
Discrete, individually-bookable slot — **not** a recurring weekly pattern. Fed into the
system **once**, at project creation, from the institute's counsellor-availability
Excel sheet (`Counsellor ID, Counsellor Name, Date, Day, Time Slot, Start Time, End
Time`), one row per bookable instance. Never added to afterward (single upload, ever —
see `docs/session-scheduling-use-cases.md` resolved decisions #1 and B). A slot moves
`OPEN → BOOKED` when a `Session` is created against it (`sessionId` set), and back to
`OPEN` if that session is later cancelled or rescheduled off of it.

| Field | Type | Notes |
|---|---|---|
| counsellorId | String | FK → Counsellor |
| projectId | String | FK → Project |
| slotDate | Date | |
| startTime, endTime | String | "HH:mm", 24h |
| status | `SlotStatus` enum | OPEN / BOOKED |
| sessionId | String? | FK → Session, unique — the session currently holding this slot |

Unique on `(counsellorId, slotDate, startTime)`. This model replaced the earlier
`CounsellorAvailability` (a recurring `daysOfWeek[] + startTime/endTime` rule), which
didn't match the real flow.

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
is, and `counsellorId` is derived from the slot owner at booking time (first-available
`CounsellorSlot` matching the picked date/time, in upload/creation order — see
`docs/session-scheduling-use-cases.md` resolved decision A). Session 2 must reuse the
same `counsellorId` as Session 1, and every future reschedule of either session keeps
that same counsellor (enforced in the service layer via `CounsellorSlot`, not a DB
constraint).

| Field | Type | Notes |
|---|---|---|
| studentId | String | FK → Student, cascade delete |
| counsellorId | String | FK → Counsellor |
| sessionNumber | `SessionNumber` enum | SESSION_1 / SESSION_2 |
| scheduledDate | Date | |
| startTime, endTime | String | "HH:mm" |
| status | `SessionStatus` enum | SCHEDULED / COMPLETED / RESCHEDULED / CANCELLED |
| meetingLink | String? | plain opaque string — pasted manually (Admin/Counsellor); no Calendly/Google Meet integration yet. Also what's emailed to the parent (same link, no separate access control). |
| studentJoinedAt, counsellorJoinedAt | DateTime? | set on the "Join Now" click, not just on window entry |
| studentNoShow, counsellorNoShow | Boolean | lazily reconciled on read once `endTime` has passed with no matching join timestamp — see "Deliberate scope gaps" |
| notes | String? | counsellor's session notes/agenda |
| cancellationReason | `CancellationReason`? | STUDENT_UNAVAILABLE / COUNSELLOR_UNAVAILABLE / INSTITUTION_REQUEST / OTHER |
| cancellationNotes | String? | free text |
| rescheduledFromDate, rescheduledFromStart | nullable | prior date/time, for the "was X → now Y" display |

Unique constraints: `(studentId, sessionNumber)` — a student can't double-book the same
session number; `(counsellorId, scheduledDate, startTime)` — prevents double-booking a
counsellor's slot. Also has a 1:1 back-reference from `CounsellorSlot.sessionId`, the
slot this session currently holds (released back to `OPEN` on cancel/reschedule).

"Join Now" stays active from 10 minutes before `startTime` through `endTime` — a party
can join late, any time up to the scheduled end (resolved decision E).

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

### Career Library normalization — canonical lookups + join tables

Layered on top of the value-match directories above, so the client can **select existing
or add new** exams/courses/colleges per job role (full design:
`docs/career-library-normalization-spec.md`). Deduped canonical lookups —
`EntranceExam`/`Course` (`@@unique([name, level])`, `QualificationLevel` = UG/PG) and
`Institution` (`name @unique`) — are seeded from the `Ug*`/`Pg*` directories + entries'
arrays. Careers link to them many-to-many via `CareerEntranceExam` / `CareerCourse` /
`CareerInstitution` (composite PK, cascade). Backfill (`prisma/seed-data/career-library/
normalize.ts`, run after the import in `prisma/seed.ts`): exams/courses from each entry's
`String[]` columns, colleges from the entry's industry match. The old `String[]` columns
(`entranceExams`, `entranceExamsPG`, `topCourses`) are kept and **dual-written** during
the transition, to be dropped in a later migration.

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

**Feedback scoring** (Counsellor Satisfaction Score) adds **no tables** — it's derived
on demand from the submitted `FEEDBACK_STUDENT` / `FEEDBACK_PARENT` submissions by
`src/modules/feedback/` (methodology: `docs/10…Feedback Form_Rating Methodology.pdf`).
Each form's sections are identified by their question `fieldKey` prefix (`sse_`→S-SE,
`scd_`→S-CD, …, `prc_`→P-RC); section % = (avg ÷ 5) × 100, weighted per section, then
student 80% / parent 20%. A student's Final Score % requires **both** forms submitted;
the counsellor's Overall Score % averages the Final Score % of their complete-pair
students (linked via `Session`). Nothing is persisted — recomputed each request.

### Assessment — `AssessmentQuestion` / `AssessmentAttempt` / `AssessmentAnswer` / `AssessmentResult`

Real content is seeded for cohort `CLASS_9_10` (`prisma/seed-data/assessment/class9to10.ts`):
73 questions across four sections — RIASEC interest inventory (24, Likert), Big Five
personality (20, Likert), Aptitude reasoning (20, single-correct MCQ with
difficulty/weight), and Cognitive & Decision Style (9, Likert). The aptitude
`correctOption` answer key is seeded from the official questionnaire PDF, so attempts
are auto-scored on submit.

**Scoring engine** (`src/modules/assessment/scoring/`): a set of pure functions run on
submit. Trait % scoring, grading bands, tie-breaks and profile flags per the Assessment
Tool Construct; Dominant Career Style (top-3 RIASEC → 1 of 120 codes) and Dominant
Personality Style (top-2 Big Five → 1 of 20 codes); Stream Fit (weighted match against
Class 11&12 sub-streams); and the reliability measures (Difficulty Consistency, ACI,
ORI, RVS); Stream Fit; Graduation Pathways; and Career Fit. The lookup/weight tables and
code-style descriptions are generated from the Traits & Weightages workbook by
`scripts/export-assessment-scoring.py` into `scoring/data/*.ts` (bundled as TS so they
compile into `dist` for runtime — they are scoring config, not queryable reference
data). RVS uses the confirmed "sum" aggregation (`100 − Σ per-pair penalties`) so the
grade bands are reachable.

Career Fit ranks at the **domain** level: the workbook's "Domain Wtg" sheet is keyed by
`(industry, domain)` — 40 industries carry a single "All Domains" row, while Defence /
Merchant Navy / Entrepreneurship enumerate specific domains (a few of those rows sum to
85-95, so the engine normalizes by weight total). Each career-library domain resolves its
weights as exact `(industry, domain)` → industry "All Domains" → industry average. The
top 6 industries' best domains become the career cards, one representative career each
(highest AI-resilience). Graduation Pathways applies the same weighted method to the
`Graduate_Streams` sheet (72 options, all summing to 100). **Deferred pending PWC
sign-off**: only Time-Consistency + composite ARI (need per-question timing). See the
"unresolved" list below.

- `AssessmentQuestion`: `cohort, section` (`AssessmentSection`: RIASEC / BIG_FIVE /
  APTITUDE / COGNITIVE), `questionCode, fieldKey, questionText, format`
  (`AssessmentQuestionFormat`: LIKERT_5 / MCQ_SINGLE), `options` (Json, MCQ_SINGLE only),
  `trait, traitCode` (e.g. "REALISTIC"/"R1", "NUMERICAL"/"NR1"), `difficulty`
  (aptitude only), `weight`, `correctOption` (aptitude only). Unique on
  `(cohort, fieldKey)` and on `(cohort, order)` — same reasoning as `FormQuestion`: a
  future cohort (e.g. Class 11-12, with its own question count per the FSD) gets its
  own `cohort` value and its own independent order sequence. Reverse-keyed items and
  RVS mirror pairs are held in the scoring config, not on the row (a question can be in
  more than one mirror pair).
- `AssessmentAttempt`: one per student attempt, `status` (IN_PROGRESS / SUBMITTED),
  `startedAt, submittedAt`.
- `AssessmentAnswer`: one per `(attemptId, questionId)`, `selectedOption` as Json (a
  Likert value 1-5, or an MCQ option letter), plus optional `timeTakenMs` (per-question
  elapsed time; feeds the aptitude Time-Consistency measure once the frontend sends it).
- `AssessmentResult`: 1:1 with an attempt. `traitScores` (Json flat map trait → 0-100),
  `report` (Json — the full computed report: layer scores + grades, DCS/DPS, Stream Fit,
  reliability dashboard), `recommendedStreams` (String[], Stream Fit top-3),
  `dominantCareerStyle` / `dominantPersonalityStyle` (denormalized style labels),
  `engineVersion`, `summary`.

### `CounsellorChart`
Auto-generated on assessment completion (aggregating pre-counselling + parent
responses + assessment result), then live-edited by the assigned counsellor during
sessions. 1:1 with `Student`.

| Field | Type | Notes |
|---|---|---|
| strengths, hobbies | String[] | counsellor-edited during sessions |
| careerShortlist | String[] | narrowed from 6 → 2 across Session 1 → Session 2 |
| rawData | Json? | optional snapshot; the chart is assembled live on GET, not from here |
| scri* (6 indicators) + scriTotal/scriBand/scriBandLabel | Int?/String? | Student Career Readiness Index — each indicator 1–4; total/band/label derived on save |
| academicTrend | `AcademicTrend`? | IMPROVING / STABLE / DECLINING / NOT_ASSESSED |
| alignmentRating | `AlignmentRating`? | Academic × Career alignment |
| finalizedAt | DateTime? | set on finalize (advances workflow to `COUNSELLOR_FEEDBACK`) |
| lastEditedBy | String? | Counsellor id (audit stamp, not an FK) |

`CounsellorChartNote` (child, `@@unique([chartId, code])`) holds one synthesis note per
section code (`A1`..`H4`). The chart is **assembled live** by `src/modules/counsellor-chart/`
(profile + both pre-counselling forms side-by-side + assessment result + flagged mirror
pairs); only the counsellor-authored fields above are persisted.

**Mirror-pair amendments** write to `AssessmentAnswer.counsellorOverrideOption`
(`+ overriddenByCounsellorId/overriddenAt`), preserving the student's original
`selectedOption`. Scoring uses `override ?? selectedOption`, so an amendment re-runs the
whole engine and updates the `AssessmentResult` — the counsellor's change affects the
actual results, not just RVS.

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

- **Assessment scoring — deferred components.** The core engine ships (see Assessment
  section above), but four report pieces await PWC confirmation and are `null`/omitted
  until then: **Time-Consistency + composite ARI** — needs per-question `timeTakenMs`
  from the frontend; the field and engine hook exist and activate automatically once
  timing arrives. Everything else in the report is live. Two interpretation calls,
  confirmed with PWC and documented in code: (a) RVS uses "sum" aggregation (the
  Construct's "average" wording would make the lower grade bands unreachable); (b) a
  Difficulty-Consistency clean sweep is treated as non-penalized (a perfect aptitude
  pattern isn't one of the 6 "unusual" signatures). Career Fit ranks at domain level and
  normalizes the few non-100 weight rows.
- **Institution subscription fields** (renewal date, seats, career-library-sync status)
  — mentioned in the functional spec but no concrete field list supplied yet.
- **Notification log** — email/reminder delivery isn't persisted; sending is treated as
  a side effect, not a DB record, for now.
- **Audit log** (chart edits, report access, admin approvals) — a cross-cutting
  security requirement from the spec, not yet modeled as a table.
- **No-show reconciliation timing** — `studentNoShow`/`counsellorNoShow` are set
  lazily, on the next read of a session after its `endTime` has passed with no
  matching join timestamp, rather than by a background job. Functionally equivalent
  for a UI that reads sessions on every dashboard load, but the flag won't flip until
  something reads that session again.
- **Real meeting-link generation** — `Session.meetingLink` is a plain opaque string,
  populated manually. No Calendly/Google Meet integration exists.
- **Session-scheduling role checks** — the Sessions API has no auth/role enforcement
  yet (matches the rest of the app); `role`/`initiatedBy` are trusted request body
  fields, not derived from an authenticated caller.

## Known conflicts between source documents (resolved)

These came from comparing the original Functional Specification Document against the
later Prompt Engineering Doc — resolved via a direct walkthrough with the user on
2026-08-06 (see `docs/session-scheduling-use-cases.md` for the full resolution log) and
now reflected in the `CounsellorSlot`/`Session` schema and the Sessions module:

1. **Session booking flow**: confirmed **blind** — the student never sees the
   counsellor; `counsellorId` is derived from the first-available slot matching their
   date/time pick. Session 1 and Session 2 are booked together in one atomic flow, and
   Session 2 is locked to Session 1's counsellor with a minimum 2-calendar-day gap.
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
