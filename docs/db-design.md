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
 └─ Session (as the assigned counsellor)
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
| lastLoginAt | DateTime? | null until the first successful password login; set on every `POST /auth/login` (token refreshes don't touch it). Backs the admin list's "Last Active" column |
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
stored; the raw token lives only in the emailed `${APP_WEB_URL}/reset-password-confirm?token=...`
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

### `Language`
Read-only lookup of the language a project is delivered in, to populate the project-creation
dropdown (`GET /languages`). `English` is seeded as the default (`isDefault: true`) and is the
only row today; managed via `prisma/seed.ts` (no CRUD API). A `Project` references it via the
nullable `languageId` FK — the service resolves the default on create, so new projects always
carry a language (see `Project`).

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| code | String | unique, BCP 47 / ISO 639-1, e.g. `en` |
| name | String | human label, e.g. "English" |
| isActive | Boolean | default true; `GET /languages` returns active only |
| isDefault | Boolean | default false; exactly one row (English) is the default used when a project omits `languageId` |
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
| code | String | unique; admin-supplied human-readable id, e.g. `P0001`. Required on create — the service no longer generates it. |
| instituteId | String | FK → Institute, cascade delete |
| name | String | unique per institute |
| fromDate, toDate | DateTime | cohort duration |
| status | `ProjectStatus` enum | ACTIVE / CLOSED / DELETED (DELETED = reversible soft-delete via `DELETE` + `PATCH /:id/restore`; hidden from default listings). A `CLOSED` or `DELETED` project can additionally be permanently purged via `DELETE /:id/purge` — see Data retention below. |
| languageId | String? | FK → Language. Nullable at the DB level (pre-language backfill), but the service resolves the default (English) on create, so new projects always carry one. Future: admins pick another language at creation. |

### `Counsellor`
Extends `User` (role=COUNSELLOR). Belongs to at most one institute; assigned to
specific projects via `ProjectCounsellor`.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| userId | String | FK → User, unique, cascade delete |
| counsellorCode | String | unique; admin-supplied login id, e.g. `C0001`. Required on create — the service no longer generates it. |
| instituteId | String? | FK → Institute. Nullable — a counsellor can be created into an unassigned pool with no institute, and picks one up when it's first assigned to a project (`POST /counsellors/{id}/projects`, which backfills this from the project's institute) |
| mobile | String | unique, E.164 |
| meetingLink | String? | the counsellor's one fixed meeting room (their own Zoom/Meet room) — plain opaque string, no Calendly/Google Meet integration. Every session assigned to this counsellor shares this same link; `Session` has no link field of its own (resolve via `session.counsellor.meetingLink`). |

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
| studentCode | String | unique; admin-supplied login id, e.g. `S0001`. Required on create — the service no longer generates it. |
| projectId | String | FK → Project, cascade delete |
| divisionId | String | FK → InstituteDivision |
| mobile | String | unique, E.164 |
| whatsappNumber | String? | optional, only if different from mobile |
| parentMobile | String | unique, E.164; primary contact for session links/notifications (Student Profile Form, Section A) |
| parentEmail | String | unique; primary contact, same as above |
| fatherName | String | Student Profile Form, Section B |
| fatherOccupation | String? | optional (bulk imports may omit) |
| fatherEmployer | String? | optional ("if applicable") |
| motherName, motherOccupation | String? | Student Profile Form, Section C; optional (bulk imports may omit) |
| motherEmployer | String? | optional ("if applicable") |
| workflowStatus | `WorkflowStatus` enum | see lifecycle below |
| isDiscontinued | Boolean | dropped out of the project mid-way; default `false` — see below |
| discontinuedAt | DateTime? | set when `isDiscontinued` flips true, cleared on reinstate |
| discontinuedReason | String? | optional free-text reason from `POST /students/{id}/discontinue` |

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

Every stage has a real trigger (see the trigger table in `docs/api-list.md`); the admin
`PATCH /students/{id}/workflow-status` override is a correction tool, not the normal
path. The tail of the lifecycle is driven by: a counsellor-chart save with real content

**Discontinuing a student** (dropped out mid-project — transferred schools, opted out,
...) is deliberately **not** modeled as a `workflowStatus` value: that enum is
forward-only and every stage already has a real trigger, so a terminal-but-not-`CLOSED`
state doesn't fit the same switch-driven model `advanceWorkflowStatus`/`studentStage.ts`
rely on. Instead `isDiscontinued`/`discontinuedAt`/`discontinuedReason` sit alongside
`workflowStatus` (untouched) — `POST /students/{id}/discontinue` sets them,
`POST /students/{id}/reinstate` clears them. `stageInfo.stage` reads `DISCONTINUED`
while the flag is set (never ageing/missed-session flagged), then resumes from
`workflowStatus` on reinstate. This is a mark-inactive action, not a delete — unlike
`DELETE /students/{id}`, no data is removed.
(`COUNSELLOR_FEEDBACK_REPORT`), chart finalize (`COUNSELLOR_FEEDBACK` — this is what
writes `CounsellorChart.finalizedAt`), both feedback forms submitted
(`STUDENT_PARENT_FEEDBACK`), and the **student's own** fetch of their assessment report
(`CLOSED`). Advances are forward-only and idempotent, and the close is additionally
gated on the student already being at `STUDENT_PARENT_FEEDBACK` so an early report fetch
can't skip the intervening stages.

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
| studentJoinedAt, counsellorJoinedAt | DateTime? | set on the "Join Now" click, not just on window entry |
| studentNoShow, counsellorNoShow | Boolean | lazily reconciled on read once `endTime` has passed with no matching join timestamp — see "Deliberate scope gaps" |
| notes | String? | counsellor's session notes/agenda |
| cancellationReason | `CancellationReason`? | STUDENT_UNAVAILABLE / COUNSELLOR_UNAVAILABLE / INSTITUTION_REQUEST / OTHER |
| cancellationNotes | String? | free text |
| rescheduledFromDate, rescheduledFromStart | nullable | prior date/time, for the "was X → now Y" display |
| studentRescheduleUsed | Boolean | "only 1 self-service reschedule per session" (`docs/Session Handling_Cancellation  Rescheduling.pdf` §1) — set on a successful STUDENT-initiated reschedule, blocks a further one (routes to Admin). Not consumed by ADMIN/COUNSELLOR-initiated moves. Reset to false when a cancelled session is reactivated (fresh start), including via the Option B restart flow. |
| counsellorRescheduleReason, counsellorProposedDate, counsellorProposedStartTime, counsellorProposedEndTime | nullable | a pending counsellor-initiated reschedule proposal (same doc, §3) — non-null `counsellorProposedDate` means one's awaiting the student's accept/decline. Doesn't move `scheduledDate`/`startTime`/`endTime` until accepted. Cleared on accept, decline, any other reschedule, or cancellation. |

Unique constraints: `(studentId, sessionNumber)` — a student can't double-book the same
session number; `(counsellorId, scheduledDate, startTime)` — prevents double-booking a
counsellor's slot. Also has a 1:1 back-reference from `CounsellorSlot.sessionId`, the
slot this session currently holds (released back to `OPEN` on cancel/reschedule).

"Join Now" stays active from 10 minutes before `startTime` through `endTime` — a party
can join late, any time up to the scheduled end (resolved decision E).

### `CareerCluster` / `CareerIndustry` / `CareerDomain` — career taxonomy
Admin-managed 3-level classification hierarchy (Cluster → Industry → Domain), seeded from the
workbook's distinct values (13 clusters / 43 industries / 571 domains) and editable via the
`/api/v1/career-taxonomy/*` endpoints. A `CareerLibraryEntry` points at its leaf `CareerDomain`.

| Model | Key fields | Notes |
|---|---|---|
| `CareerCluster` | `name`, `deletedAt?` | top level; `name` unique among live rows |
| `CareerIndustry` | `clusterId` (FK), `name`, `deletedAt?` | belongs to one cluster; `(clusterId, name)` unique among live rows |
| `CareerDomain` | `industryId` (FK), `name`, `deletedAt?` | belongs to one industry; `(industryId, name)` unique among live rows. Domain **names repeat across industries** (e.g. "Academia" under several), so uniqueness is per-industry. Education Path entries are **not** owned by a domain — see `EducationEntry` below |

- **Soft delete**: `deletedAt` (null = live). Deleting hides a node from the pickers/tree but keeps
  its FK intact, so job roles that still reference it keep resolving; restorable via
  `POST .../restore`. Name uniqueness is enforced in the service layer over live rows only (not a DB
  constraint — a partial unique index can't be expressed in the Prisma schema without being flagged
  as drift), so a soft-deleted name can be reused.
- **Ids** may be cuid (app/seed-created) or uuid (rows backfilled by the `normalize_career_taxonomy`
  migration via `gen_random_uuid()`).

### `CareerLibraryEntry`
Central, PWC-owned career database. The "CL" tab is now imported from
`docs/Career Library_Updated_1808.xlsx` — 1,317 rows via
`scripts/export-career-library.py` + `prisma/seed-data/career-library/` (the 1808
workbook added the yellow columns: `roleOverview`, `keySkills`,
`qualification10th12thExplanation`, and the `*Defined` qualification variants). The
reference tabs (UG/PG institutions, exams, courses) are imported from the same 1808
workbook. See "Career Library workbook import" below for the full import design and
cross-table mapping.

| Field | Type | Notes |
|---|---|---|
| domainId | String (FK → `CareerDomain`) | leaf of the normalized Cluster → Industry → Domain taxonomy; cluster/industry are derived by walking up the relations (was three free-text `cluster`/`industry`/`domain` columns before the `normalize_career_taxonomy` migration) |
| jobRole | String | the career's title |
| aiResilienceGrade | `AiResilienceGrade` enum | LOW / MEDIUM / HIGH / VERY_HIGH (source only uses the first three) |
| aiResilienceComment | String | justifies the grade |
| oneLineDescription | String | |
| roleOverview | String? | longer-form role write-up (yellow "Role Overview & Scope" column added in the 1808 workbook) |
| keySkills | String[] | key skill requirements (yellow "Key Skill Requirements" column; comma-separated in the source, split to a list) |
| topCompanies | String[] | tag-style multi-value |
| salaryIndiaRangeText | String? | raw source text, e.g. "₹6–25 LPA" (kept — source has non-numeric ranges like "0–Limitless") |
| salaryIndiaMinLPA, salaryIndiaMaxLPA | Float? | best-effort parse of the above; null when unparseable |
| salaryGlobalRangeText | String? | raw source text, e.g. "$70k–$160k" |
| salaryGlobalMinUSD, salaryGlobalMaxUSD | Float? | best-effort parse (in USD, not $k); null when unparseable |
| qualification10th12th | String? | optional — a role need not state a 10+2 entry requirement (every workbook-imported row happens to have one, but the API doesn't demand it) |
| qualification10th12thExplanation | String? | the "10+2 Explanation" note (yellow column) accompanying the 10th/12th qualification |
| qualificationGraduation, qualificationPG | String? | source has 3 distinct qualification levels, not 1 |
| qualificationGraduationDefined, qualificationPGDefined | String? | cleaned/normalized "DEFINED" variants of the graduation/PG qualifications (yellow columns added in the 1808 workbook) |
| entranceExamsUGDescription | String? | full descriptive text from the source |
| entranceExams | String[] | UG level, cleaned/short exam names — join key against `UgEntranceExam.examName` |
| entranceExamsPG | String[] | PG level |
| certificationsStudent, certificationsUG | String[] | source distinguishes pre-UG vs. during-UG certification recommendations |
| topCourses | String[] | tag-style multi-value |
| status | `CareerLibraryStatus` enum | DRAFT / ACTIVE — the publish flag. A counsellor never writes this table directly (see `CareerLibraryEntryProposal` below), so every row here was either admin-authored or copied in on proposal approval — there's no separate review state to track |
| createdBy, updatedBy | String | User id, or `"seed:career-library-import"` for bulk-imported rows. On a proposal-approved row, `createdBy` is the counsellor who submitted it, not the admin who approved it |

### `CareerLibraryEntryProposal`
A counsellor's proposed job role, staged **entirely outside** `CareerLibraryEntry` — the
real table only ever holds admin-authored or admin-approved rows, with no `PENDING`/`DRAFT`
rows to filter out of reads. Mirrors `CareerLibraryEntry`'s scalar columns; the exam/course/
institution/education-entry links are recorded as plain id arrays (`examIds`, `courseIds`,
`institutionIds`, `educationEntryIds`) rather than join-table rows, since there's no real
`CareerLibraryEntry.id` to join against yet. Approving copies the row into a **new**
`CareerLibraryEntry` (fresh id, `status:ACTIVE`) and materializes the join-table rows from
those id arrays, then deletes the proposal; rejecting just deletes it. No DB-level FK on
`domainId` — validated against the live taxonomy in the service instead, since the row is
meant to be short-lived. See `POST/GET /career-library/proposals` and
`/proposals/{id}/approve`\|`reject` in `docs/api-list.md`.

| Field | Type | Notes |
|---|---|---|
| (scalar fields) | — | same as `CareerLibraryEntry` minus `entranceExams`/`entranceExamsPG`/`topCourses`/`status`/`createdBy`/`updatedBy` — those three String[] columns and the join rows are derived from the id arrays below at approval time |
| examIds, courseIds, institutionIds, educationEntryIds | String[] | ids of already-resolved `EntranceExam`/`Course`/`Institution`/`EducationEntry` rows (find-or-create against those real tables happens at submit time, same as the admin-only inline "add new") |
| submittedBy | String | User id (counsellor) |
| createdAt, updatedAt | DateTime | |

### Career Library workbook import — UG/PG reference tables

`docs/Career Library_Updated_1808.xlsx` has 8 tabs; the last (`Post-12_Entrance_Exams__India__`)
is out of scope per instruction and was not imported. The other 7 tabs each map to
exactly one table — no FK relations to `CareerLibraryEntry` or to each other; they're
matched **by value** at query time, not by foreign key. (All tabs, including the UG/PG
reference tables, are now sourced from the 1808 workbook; note its `UG Institutions_IND`
tab dropped the "Programmes Offered After Class 12" and "Key Programmes Offered" columns,
so `UgInstitution.programmesOfferedAfterClass12` / `keyProgrammesOffered` are now null.)

| Workbook tab | Table | Rows | Join key → `CareerLibraryEntry` |
|---|---|---|---|
| CL | `CareerLibraryEntry` | 1,317 | (the hub table) |
| UG Institutions_IND | `UgInstitution` | 702 | `industry` ↔ entry's `domain.industry.name` |
| UG Inst+Uty_IND | `UgInstitutionUniversity` | 34 | none (general directory, not industry-mapped) |
| UG Entrance_IND | `UgEntranceExam` | 109 | `examName` ↔ `CareerLibraryEntry.entranceExams` (UG, extracted) |
| UG Courses_IND | `UgCourse` | 67 | `careerCluster` ↔ entry's `domain.industry.cluster.name` |
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

After these fixes, mapping coverage is 100%: every entry's `domain.industry.name` value
has at least one matching `UgInstitution` row, every extracted UG exam token matches a
`UgEntranceExam.examName`, and every entry's `domain.industry.cluster.name` value matches at
least one `UgCourse.careerCluster`. (The `industry`/`cluster` names are now read through the
normalized taxonomy relations rather than free-text columns on the entry.)

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

Each canonical lookup also carries the detail an admin's "add new" form collects, so a
hand-added row is as complete as an imported one (columns mirror the raw `Ug*` tables):

| Model | Detail columns (all nullable) |
|---|---|
| `EntranceExam` | `fullForm`, `conductingBody`, `officialWebsite`, `examMode`, `frequency`, `applicableFor`, `subjectRequirements12th`, `applicationWindow` |
| `Course` | `fullForm`, `durationYears`, `stream12thRequirements`, `relevantEntranceExams`, `programmesOffered`, `topColleges`, `furtherStudyOptions` |
| `Institution` | `shortName`, `city`, `state`, `type`, `website`, `entranceExamsRequired`, `programmesOffered`, `ranking` |

A course's "relevant entrance exams" / "top colleges" stay **free text**, deliberately: a
course is reference data, not a second place to curate per-career links. When an inline
"add new" names a row that already exists, only **blank** columns are filled — canonical
rows are shared across job roles, so linking one must never overwrite another role's data.

### Reference-data review — `CareerLibraryStatus`

`EntranceExam`, `Course` and `Institution` each carry `status`
(`CareerLibraryStatus` = `DRAFT`/`ACTIVE`, **default `ACTIVE`**) and `submittedBy`, plus an
index on `status` — the same two-state publish flag `EducationEntry`/`CareerLibraryEntry`
use, not a separate three-state review enum.

Counsellors may propose any of these three; admins publish or reject. Review is **in
place** — the row *is* the submission, so approving is a plain `DRAFT`→`ACTIVE` flip rather
than creating anything. There is deliberately no rejected-but-kept state: reject hard-deletes
the row (refused with a 409 if it's already `ACTIVE`, or still linked to a job role — the
join table would cascade the link away silently), so a mistaken name doesn't block reuse and
there's no `reviewedBy`/`reviewedAt`/`rejectionReason` audit trail to carry.

This table previously used a 3-state `ReviewStatus` (`PENDING`/`APPROVED`/`REJECTED`) with a
rejected-but-kept row that could be reopened by re-proposing the same name, plus the audit
columns above. That was collapsed to the current 2-state flag when job-role proposals moved
to their own table (`CareerLibraryEntryProposal`, see above) — keeping a 3-state enum here
only for these three tables stopped pulling its weight once nothing else needed it.

Two tables reach the same publish-flag outcome for a different kind of submission:

- `CareerLibraryEntry` doesn't carry a review column of its own any more — a counsellor's
  **complete job role** submission is staged entirely in `CareerLibraryEntryProposal` instead
  of ever landing in this table with a pending flag (see above).
- `EducationEntry` uses the identical `DRAFT`/`ACTIVE` flag for the same reason these three
  do — see below.

- The column default is `APPROVED` so the migration leaves the already-seeded library
  (166 exams / 677 institutions / 1,319 courses) visible.
- An admin's own addition is `APPROVED` on the spot and records itself as the reviewer.
- Find-or-create interacts with review: an **admin** naming a `PENDING` row implicitly
  approves it, and anyone re-proposing a `REJECTED` row reopens it for review. Both are
  handled by `reviewOnReuse()` in `career-library.service.ts`.
- Pickers filter to `APPROVED`; a linked row's `status` is exposed on the career entry's
  `linked*` arrays so the UI can flag a pending/rejected link rather than silently dropping it.
- Rejecting one of these three **keeps** the row (marked `REJECTED`, with the reason) so it can
  be reopened. Rejecting a job role or an education entry **deletes** it instead — there's no
  reuse story for a whole role, and a tombstoned programme would just clutter the lookup.

### `EducationEntry` / `CareerEducationEntry` — Education Path

The qualifications/programmes that lead into a career. A **global canonical lookup**, on the
same footing as `EntranceExam` / `Course` / `Institution`: one row per `(level, programme)`,
reused by every job role that needs it, with **no taxonomy FK**. It was originally
`DomainEducationEntry`, owned by a `CareerDomain`; that was the odd one out among the four
reference types and meant the same programme was duplicated (and separately review-approved)
once per domain.

| Model | Key fields | Notes |
|---|---|---|
| `EducationEntry` | `level` (`EducationPathLevel`), `programme`, `description?`, `status` (`CareerLibraryStatus`), `submittedBy?` | `(level, programme)` **unique in the DB**. Indexed on `programme` (typeahead) and `status`. No reviewer/rejection audit columns and no `deletedAt`: `status` is the same `DRAFT`/`ACTIVE` publish flag `CareerLibraryEntry`/`EntranceExam`/`Course`/`Institution` use, and delete is permanent. Its `/approve` endpoint publishes `DRAFT`→`ACTIVE`; `/reject` deletes, and refuses while any `CareerEducationEntry` still points at it (those cascade, so it would silently strip the programme from live roles) |
| `CareerEducationEntry` | `careerEntryId` + `educationEntryId` (composite PK, cascade) | many-to-many; which entries this job role uses. **The only link between an education entry and the taxonomy** — a domain relates to entries transitively, through its roles |

`EducationPathLevel` = `CLASS_10_PLUS_2` \| `GRADUATE` \| `POST_GRADUATE` \|
`CERTIFICATION_STUDENT` \| `CERTIFICATION_UG`.

- **No soft delete.** Deleting an entry is permanent and cascades its `CareerEducationEntry`
  rows, so every job role that used that programme loses it. This is the one place the
  Education Path is less forgiving than the taxonomy.
- **Seeded from the workbook prose.** `prisma/seed-education-path.ts` (`pnpm db:seed:education`,
  also run as the last step of `pnpm db:seed`) derives entries and role links from the flat
  columns: `qualification10th12th` verbatim (26 distinct values across the library),
  `qualificationGraduationDefined` up to `", Recommended focus:"`, the part of
  `qualificationPG` after a literal `"PG:"`, and both `certifications*` arrays. `description`
  comes from the matching explanation column per level — `qualification10th12thExplanation`,
  `qualificationGraduationDefined`, `qualificationPGDefined` — which is the one use for the PG
  boilerplate: unusable as a programme *name*, fine as prose. Certification entries have no
  such column and carry no description. A programme shared by many roles takes the first
  non-empty explanation; `--dry-run` reports how many alternatives were discarded. It yields
  **439 programmes and 14,283 role links** over 1,319 job roles. `qualificationPGDefined` and
  `qualificationGraduation` are deliberately **not** mined — they're generated boilerplate
  sentences, not lists. Idempotent, and it never touches the flat columns.
- **Domain-scoped pickers still work**, via usage rather than ownership:
  `GET /career-library/education?domainId=` returns entries already linked to job roles in
  that domain — the same `domainScope()` filter the exam/course/institution lookups use.
- The flat `qualification10th12th` / `qualificationGraduation` / `qualificationPG` /
  `certificationsStudent` / `certificationsUG` fields on `CareerLibraryEntry` are **not**
  dual-written from this table, unlike the exam/course normalization. They hold descriptive
  prose from the source workbook rather than a list, so there is nothing to derive — the two
  layers coexist until the workbook prose is retired.

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
**Reserved — currently unused.** No code reads or writes this table. PDF rendering is
deliberately client-side (`GET /reports/students/{id}/assessment` returns the report as
JSON; the frontend renders/prints it), so there is no stored file to point at. The table
is kept as the shape a server-side renderer would persist, and only
`ReportType.STUDENT_CAREER_PATH` has an assembler at all — the parent and institution
variants aren't built. See `docs/pending-items.md` §1.3.

| Field | Type | Notes |
|---|---|---|
| studentId | String | FK → Student, cascade delete |
| generatedByCounsellorId | String | Counsellor id |
| type | `ReportType` enum | STUDENT_CAREER_PATH / PARENT_SUMMARY / INSTITUTION_SUMMARY |
| fileUrl | String | object storage location |
| generatedAt | DateTime | |

## Deliberate scope gaps (not modeled yet)

- **Assessment scoring — complete, with one conditional piece.** The core engine ships
  (see Assessment section above). **Time-Consistency + composite ARI** compute whenever
  the attempt's aptitude answers carry `timeTakenMs` — the API accepts and stores it, so
  this now depends only on whether the frontend sends timing; without it, those two
  values are `null` and listed in the report's `meta.pending`. Everything else in the
  report is live unconditionally. Two interpretation calls,
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
- **Real meeting-link generation** — `Counsellor.meetingLink` is a plain opaque string,
  populated manually (one fixed link per counsellor, shared by every session assigned to
  them — no per-session link). No Calendly/Google Meet integration exists.
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

Marking a `Project` `CLOSED` does **not** by itself purge anything — it's the soft-close
(blocks new student/parent submissions) and is reversible via `PATCH /:id/restore` on the
regular soft-`DELETE`. Permanent purge is a separate, explicit, irreversible action:
`DELETE /api/v1/projects/{id}/purge` (admin only), allowed only once the project is
already `CLOSED` or (soft-)`DELETED`. Most of the cascade is wired at the DB level (`ON
DELETE CASCADE` on every FK back to `Project`/`Student`), but the `Student.userId` FK
cascades in the `User → Student` direction only — deleting a `Student` row does **not**
delete its `User` row — so the service deletes the project's students' `User` rows
explicitly first (in the same transaction as the `Project` delete); that cascade takes
`Student` and everything scoped to it with it — sessions, form submissions/answers,
assessment attempts/answers/results, counsellor charts/notes, reports — and the
subsequent `Project` delete takes `ProjectCounsellor` links and any remaining counsellor
slots. `Counsellor` rows and their `User` accounts are untouched: `ProjectCounsellor`
cascades from `Counsellor` (so deleting a counsellor drops their project links), not the
reverse, so purging a project never touches the counsellors that were assigned to it. No
fixed retention window is
modeled per-institute yet — if an institute's contract requires a delay before purge,
that would need a `retentionDays`-style field on `Institute`, not yet added.
