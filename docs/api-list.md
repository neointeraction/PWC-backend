# API List

Live source of truth for every HTTP endpoint in this service. **Update this file in
the same change as any route added, removed, or modified** — it's the quick-reference
companion to the interactive Swagger UI.

- Interactive docs (Swagger UI): `GET /docs`
- Raw OpenAPI spec: `GET /docs/openapi.json`
- Base path for all API routes below: `/api/v1` (except `/health`, which is unprefixed)
- Auth: **route-level auth is now enforced** — see "Authentication & roles" below.
  Most endpoints require an `Authorization: Bearer <accessToken>` header; a handful are
  intentionally public (auth, health, docs, parent forms).

Last updated: 2026-08-11 (route-level auth enforcement — every route now carries a role
guard except the documented public set; see "Authentication & roles").

## Authentication & roles

Send the access token from `POST /auth/login` as `Authorization: Bearer <accessToken>`
on every non-public request. Guards live in `src/common/middlewares/auth.ts`
(`requireAuth`, `requireStudentOrStaff`, `requireStaff`, `requireAdmin`,
`authenticateStudentForm`). Failures: **401** (missing/invalid/expired token) and
**403** (authenticated but wrong role).

Role groups:
- **Student** — the student self-service flows (own assessment, own forms, session booking).
- **Staff** = `COUNSELLOR` + `ADMIN` + `SUPER_ADMIN` (+ `VIEW_ONLY_ADMIN` for reads) — operational access (view students, sessions, counsellor-chart, feedback, email).
- **Admin** = `ADMIN` + `SUPER_ADMIN` — management (create/edit/delete students & institutes, slot import, workflow override).
- **`VIEW_ONLY_ADMIN`** — sees everything staff/admins can see, but **every write is blocked**. It's in the read guards, but a global `blockViewOnlyWrites` middleware (`src/common/middlewares/auth.ts`, mounted after `/auth`) rejects any **non-GET** request from this role with **403** (`"View-only access…"`) — across every module, regardless of the route's own tier. It can still change its own password (auth self-service is exempt). Assign this role instead of `ADMIN` for a view-only app admin.

Access tiers:

| Tier | Who | Where |
|---|---|---|
| **Public** (no token) | anyone | `auth/*`, `GET /health`, `GET /docs` + `openapi.json`, and **parent forms** (`PRE_COUNSELLING_PARENT`, `FEEDBACK_PARENT`) — parents have no login; still project-window gated |
| **Any authenticated** | student or staff | career-library reads, assessment question bank |
| **Student or Staff** | `STUDENT` + staff | student forms (`*_STUDENT`), form-status, assessment attempts/result, session booking/join/reschedule/cancel |
| **Staff** | counsellor + admin | student reads, session management, counsellor-chart, feedback, email |
| **Admin** | admin + super admin | student create/update/delete + workflow-status, institutes writes, session slot import, manual session creation |

**Per-record ownership** is also enforced on the student-tier routes: a `STUDENT` token
may only act on *their own* records (matched via `Student.userId` = token `sub`). Acting
on another student's `studentId`/`attemptId`/session returns **403**; an unknown target
returns **404**. Staff bypass ownership (they act across students). Parent forms are
exempt (public, no owner). Guards: `ownStudentParam` / `ownStudentBody` /
`ownAttemptParam` / `ownSessionParam` / `ownStudentForm` in
`src/common/middlewares/ownership.ts`.

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check. Returns `{ status: "ok", timestamp }`. |

## Auth

JWT access token (short-lived, returned in the response body) + refresh token
(long-lived, httpOnly cookie, rotated on every use — `RefreshToken` table tracks
revocation). **No self-register endpoint** — every `User` (Student, Counsellor, Super
Admin) is created by an admin or seed script with a generated/configured temp
password, never by signing up. The one Super Admin login is bootstrapped by
`pnpm db:seed` (`SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD` env vars, defaults
`superadmin@kreate.local` / `ChangeMe123!` — see `.env.example`).

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Body: `{ email, password }`. 401 on wrong password, unknown email, or an inactive (`isActive: false`) user — same generic "Invalid email or password" message either way (doesn't leak which). 200 with `{ accessToken, user }`; sets the `refreshToken` httpOnly cookie (path `/api/v1/auth`). |
| POST | `/api/v1/auth/refresh` | No body — reads the `refreshToken` cookie. 401 if missing, expired, already used (rotation), or revoked (logged out). 200 with a new `{ accessToken, user }`; rotates the refresh token (new cookie, old one revoked — single use). |
| POST | `/api/v1/auth/logout` | No body — reads the `refreshToken` cookie, revokes it, clears the cookie. 204 either way — idempotent, doesn't error on a missing/already-invalid cookie. |
| POST | `/api/v1/auth/change-password` | **Requires `Authorization: Bearer`.** Body: `{ currentPassword, newPassword }` (new min 8 chars). 400 on wrong current password, too-short new, or new == current; 401 without a token. On success: 204, clears `mustChangePassword`, and **revokes all refresh sessions** (clears the cookie). |
| POST | `/api/v1/auth/forgot-password` | Public. Body: `{ email }`. Mints a single-use reset token (TTL `PASSWORD_RESET_EXPIRES_IN`, default 1h) and emails a `${APP_WEB_URL}/reset-password?token=...` link via the `PASSWORD_RESET` template. **Always 202** with the same message whether or not the email exists (no account enumeration). |
| POST | `/api/v1/auth/reset-password` | Public. Body: `{ token, newPassword }` (min 8). 400 if the token is unknown, already used, or expired. On success: 204, sets the new password, marks the token used (single-use), clears `mustChangePassword`, and revokes all refresh sessions. |

The access token payload is `{ sub: userId, role, email }`. Other modules' routes read
`req.user.role` via the guards described in "Authentication & roles" above.

## App Admins

Manage App Admin accounts (Users with role `ADMIN` or `VIEW_ONLY_ADMIN`). **SUPER_ADMIN
only** — and every operation is scoped to those two roles, so it can't touch students,
counsellors, or super admins, and can't create/escalate to `SUPER_ADMIN`. The `role`
field on create/update is the **view-only toggle** (`VIEW_ONLY_ADMIN` = read-only admin,
enforced by `blockViewOnlyWrites`).

Every admin object returned here carries `id, email, role, firstName, lastName,
isActive, mustChangePassword, lastLoginAt, createdAt, updatedAt`. `lastLoginAt` is
`null` until the admin's first successful login and is refreshed on each
`POST /auth/login` — render it as the "Last Active" column (`N/A` when `null`).

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/admins` | Create an App Admin. Body: `firstName, lastName, email, role?` (`ADMIN` \| `VIEW_ONLY_ADMIN`, default `ADMIN`). Returns the admin + one-time `tempPassword`. 400 if `role` isn't one of the two; 409 on duplicate email. |
| GET | `/api/v1/admins` | List App Admins (newest first). Query: `role?`. |
| GET | `/api/v1/admins/{id}` | Get one App Admin. **404 for any non-admin user id** (role-scoped). |
| PATCH | `/api/v1/admins/{id}` | Update `firstName?, lastName?, role?, isActive?`. `role` flips `ADMIN` ↔ `VIEW_ONLY_ADMIN`; `isActive:false` deactivates the login. |
| POST | `/api/v1/admins/{id}/regenerate-password` | Mint a fresh temporary password for an App Admin. Returns `{ admin, tempPassword }` — the new plaintext password is shown **once** (never stored in the clear) and `mustChangePassword` is set. 404 for a non-admin id. |
| DELETE | `/api/v1/admins/{id}` | Delete an App Admin (they own no dependent records). 404 for a non-admin id. |

## Institutes

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/institutes` | Create an institute. Body: `name, address?, contactNumber (E.164), primaryEmail` (`address` optional, stored as `""` when omitted). Name/contactNumber/primaryEmail unique. |
| GET | `/api/v1/institutes` | List all institutes. |
| GET | `/api/v1/institutes/{id}` | Get one institute, including its classes/divisions. |
| PATCH | `/api/v1/institutes/{id}` | Update an institute (partial body, same fields as create). |
| DELETE | `/api/v1/institutes/{id}` | Delete an institute (cascades to its classes/divisions/projects). |
| POST | `/api/v1/institutes/{id}/classes` | Create a class under an institute. Body: `name`. |
| GET | `/api/v1/institutes/{id}/classes` | List an institute's classes (with their divisions). |
| POST | `/api/v1/institutes/{id}/classes/{classId}/divisions` | Create a division under a class. Body: `name`. |
| GET | `/api/v1/institutes/{id}/classes/{classId}/divisions` | List a class's divisions. |

## Cohorts

Read-only lookup for cohort dropdowns (e.g. selecting a cohort when creating a project).
`Cohort.code` (e.g. `CLASS_9_10`) is the canonical string that the cohort-scoped content
(forms, assessment questions/attempts) matches on — those columns stay plain strings, not
FKs, for now. Only `CLASS_9_10` exists today. No CRUD yet — cohorts are managed via seed.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/cohorts` | List active cohorts (`{ id, code, name, displayOrder }`), ordered by `displayOrder`. Staff. |

## Languages

Read-only lookup for the language a project is delivered in (populates the project-creation
language dropdown). `English` is seeded as the default (`isDefault: true`) and is the only
option today — more can be added via seed. No CRUD yet.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/languages` | List active languages (`{ id, code, name, isDefault, displayOrder }`), ordered by `displayOrder`. Staff. |

## Projects

A counselling cycle/cohort run for an institute — students, forms, assessments, sessions
are all scoped to a Project. Reads = staff; writes/management = admin.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/projects` | Create a project. Body: `instituteId, name, fromDate, toDate, status?` (`ACTIVE`\|`CLOSED`, default `ACTIVE`), `languageId?` (from `GET /languages`; **omitted → defaults to English**). A human-readable `code` (`P0001`, `P0002`, …) is auto-generated and returned. 400 if `instituteId`/`languageId` is unknown or `fromDate > toDate`; 409 on a duplicate `name` within the same institute. Responses include `code` and `language: { id, code, name }`. |
| GET | `/api/v1/projects` | List projects (with institute + `_count` of students/counsellors/counsellorSlots). Query: `instituteId?, status?`. **No `status` → excludes soft-deleted** (returns `ACTIVE` + `CLOSED`); `status=DELETED` lists only soft-deleted; `status=ACTIVE`/`CLOSED` filter exactly. |
| GET | `/api/v1/projects/{id}` | Get one project (any status, incl. `DELETED`). 404 if unknown. |
| PATCH | `/api/v1/projects/{id}` | Update (partial): `name?, fromDate?, toDate?, status?, languageId?` (`status` writable values are `ACTIVE`/`CLOSED` only — use DELETE/restore for `DELETED`). Re-validates the effective date window (400 if merged `fromDate > toDate`); 400 if `languageId` is unknown. `status:CLOSED` is the soft-close — the project-window gate then rejects student/parent submissions. |
| DELETE | `/api/v1/projects/{id}` | **Soft-delete** — sets `status:DELETED` (reversible; **data is preserved**, no cascade). Returns the updated project (`200`). Hidden from the default list; its student/parent submissions are blocked (`reason:PROJECT_DELETED`). 404 if unknown. |
| PATCH | `/api/v1/projects/{id}/restore` | **Restore** a soft-deleted project — always back to `status:ACTIVE` (prior status isn't tracked). Returns the updated project. 404 if unknown. |

## Students

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/students` | Create a student. Also creates a linked `User` (role `STUDENT`) with a temp password (from the `password?` body field if given, otherwise generated; `mustChangePassword` set), returned once in the response. Body: `firstName, lastName, email, mobile, whatsappNumber?, studentCode?, projectId, divisionId, parentMobile, parentEmail, fatherName?, fatherOccupation?, fatherEmployer?, motherName?, motherOccupation?, motherEmployer?` — `studentCode` is **auto-generated** (`S0001`, `S0002`, …) when omitted (supply it only to carry a legacy/import code); the father/mother breakdown is optional (bulk imports may carry only a single parent contact); `fatherOccupation`, `motherName`, `motherOccupation` are stored as `null` when omitted (`fatherName` stored as `""`). |
| GET | `/api/v1/students` | List students, each with a computed **`stageInfo`** (see "Student stage & ageing" below). Query: `projectId?, divisionId?, workflowStatus?` plus the derived-stage/ageing filters `stage?` (derived-stage dropdown key) and `flagged?` (`true`/`false` — the 🚩 follow-up toggle). Staff only. |
| GET | `/api/v1/students/me` | **Student self-service.** The logged-in student's own record (with user, project, division, `studentCode`, `workflowStatus`, contacts, and the active `cohort: { code, name }`). This is the entry point every student-facing page needs — it hands the frontend the `Student.id`, `projectId` and `cohort` that all downstream `:studentId`-keyed routes (forms, assessment, sessions) require. 404 for a non-student account (staff have no `Student` row). |
| PATCH | `/api/v1/students/me` | **Student self-service edit.** The logged-in student updates their own contact/parent details. Partial body, whitelisted fields only: `whatsappNumber`, `parentMobile`, `parentEmail`, `fatherName`, `fatherOccupation`, `fatherEmployer`, `motherName`, `motherOccupation`, `motherEmployer`. Identity/enrolment (`firstName`/`lastName`, `email`, primary `mobile`, `studentCode`, `divisionId`, `projectId`, `workflowStatus`) is **not** editable here — those stay admin-only via `PATCH /students/{id}`. Allowed at any workflow stage. Returns the same enriched shape as `GET /students/me`. 404 for a non-student account. |
| GET | `/api/v1/students/{id}` | Get one student (with user, project, division). Includes `workflowStatus`. Staff only — students read themselves via `/students/me`. |
| PATCH | `/api/v1/students/{id}` | Update a student (partial body; validates `divisionId` still belongs to the student's project institute if changed). |
| DELETE | `/api/v1/students/{id}` | Delete a student (deletes the linked `User` too, which cascades). Also releases any `CounsellorSlot` still `BOOKED` by the student's sessions back to `OPEN` before the cascade deletes those `Session` rows — otherwise the slot would be stranded (`ON DELETE SET NULL` clears its `sessionId` but not its `status`), permanently unbookable. |
| POST | `/api/v1/students/{id}/confirm-profile` | Student confirms **their own** profile data (father/mother details, parent contact) is correct — or staff on their behalf (a student confirming another student's profile is `403`). Advances `workflowStatus` `DRAFT → PROFILE_COMPLETED`. 409 if not currently `DRAFT`. |
| PATCH | `/api/v1/students/{id}/workflow-status` | Admin/ops override — sets `workflowStatus` directly (not forward-only, unlike the automatic triggers below). Body: `{ workflowStatus }`. Covers the stages not yet wired to a real trigger (Sessions, Counsellor Chart/Feedback, Reports don't exist as modules yet). |

### Student stage & ageing (`stageInfo`)

`GET /students`, `GET /students/{id}` and `GET /students/me` each attach a computed
`stageInfo` — the **derived display stage** (finer-grained than `workflowStatus`; it splits
the "— Student/— Parent" halves) plus **ageing** and the **🚩 follow-up flag**. It is
computed live from existing data (form/assessment/session timestamps) and **never stored** —
ageing changes with the clock, so persisting it would go stale. Implemented in
`src/modules/students/studentStage.ts`.

```jsonc
"stageInfo": {
  "stage": "PRE_COUNSELLING_STUDENT",     // derived-stage key (use as the `stage` filter)
  "stageLabel": "Pre-Counselling — Student",
  "stageEnteredAt": "2026-08-11T09:00:00.000Z", // the timestamp ageing is measured from
  "ageDays": 4,                           // calendar days (IST) idle in this stage
  "flagged": true,
  "flagReason": "IDLE"                    // "IDLE" | "MISSED_SESSION" | null
}
```

- **Idle flag** — set when the stage awaits a student/parent action and `ageDays` **>
  2** calendar days (`AGEING_FLAG_THRESHOLD_DAYS`). Actionable stages: `LOGIN_ACTIVATED`,
  `PROFILE_COMPLETED`, `PRE_COUNSELLING_STUDENT/PARENT`, `ASSESSMENT_PENDING`,
  `ASSESSMENT_COMPLETED`, `FEEDBACK_STUDENT/PARENT`.
- **Missed-session flag** — set when a booked session's date has passed while still
  `SCHEDULED`, or the student was marked no-show. This is how the session stages surface a
  flag; they are **never** ageing-flagged.
- **Never flagged**: `SESSION_BOOKED` (except missed), `SESSION_1/2_COMPLETED`, the
  counsellor-feedback stages, and `CLOSED` (staff-side or terminal).
- **Filters**: `?stage=<key>` matches `stageInfo.stage`; `?flagged=true` returns only
  flagged students (the admin follow-up list). Both are computed in the service, not SQL.

## Counsellors

Admin-managed CRUD for counsellor accounts (each backed by a `User` with role
`COUNSELLOR`). Reads = staff; writes/assignment = admin.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/counsellors` | Create a counsellor. Also creates a linked `User` (role `COUNSELLOR`) with a temp password (from the `password?` body field if given — e.g. carried in an import sheet — otherwise generated), returned once. `mustChangePassword` is set so it's changed at first login. Body: `firstName, lastName, email, mobile, counsellorCode?, password?, instituteId, projectIds?` — `counsellorCode` is **auto-generated** (`C0001`, `C0002`, …) when omitted (supply it only to carry a legacy/import code). 400 if `instituteId` is unknown or any `projectId` isn't under that institute; 409 on duplicate `email`/`mobile`/`counsellorCode`. |
| GET | `/api/v1/counsellors` | List counsellors (with user, institute, assigned projects). Query: `instituteId?, projectId?` (filters to counsellors assigned to that project). |
| GET | `/api/v1/counsellors/{id}` | Get one counsellor. 404 if unknown. |
| PATCH | `/api/v1/counsellors/{id}` | Update. Body (partial): `firstName?, lastName?, mobile?, isActive?`. `isActive:false` deactivates the login without deleting. |
| DELETE | `/api/v1/counsellors/{id}` | Delete (removes the linked `User`, cascading the counsellor, its slots, and project links). **409 if the counsellor has any `Session`** (would orphan session history) — deactivate with `isActive:false` instead; `error.details.sessionCount` is returned. |
| POST | `/api/v1/counsellors/{id}/projects` | Assign the counsellor to a project (`ProjectCounsellor`). Body: `{ projectId }`. 400 if the project isn't under the counsellor's institute; 409 if already assigned. Returns the updated counsellor. |
| DELETE | `/api/v1/counsellors/{id}/projects/{projectId}` | Unassign from a project. 404 if not currently assigned. Returns the updated counsellor. |

## Forms

Serves the seeded pre-counselling and feedback form templates (question content —
see `docs/db-design.md` for the full schema notes).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/forms/{formType}` | Get a form template with its questions, ordered. `formType`: `PRE_COUNSELLING_STUDENT` \| `PRE_COUNSELLING_PARENT` \| `FEEDBACK_STUDENT` \| `FEEDBACK_PARENT` (the student profile is captured at `POST /students`, not via the forms API — `STUDENT_PROFILE` is rejected with 400). Query: `cohort` (required, e.g. `CLASS_9_10`), `version?` (defaults to the active version). 404 if no template exists for that formType+cohort. |
| GET | `/api/v1/forms/{formType}/students/{studentId}` | Get a student's (or parent's) submission for a form, with answers. Query: `cohort` (required), `version?`. 404 if no submission exists yet. |
| PUT | `/api/v1/forms/{formType}/students/{studentId}` | Save/update in-progress answers ("Save as Draft"). Body: `cohort, version?, answers: [{ fieldKey, answer }]`. Upserts a `FormSubmission` + `FormAnswer` rows; idempotent, callable repeatedly. 400 on an unknown `fieldKey`. 409 if the form was already submitted (locked). |
| POST | `/api/v1/forms/{formType}/students/{studentId}/submit` | Finalize a submission. Same body shape as the draft `PUT` (answers here are merged with any existing draft). Validates every `isRequired` question has a non-empty answer — 400 with `{ missingFieldKeys }` if not — then sets `submittedAt` and locks the submission. 409 if already submitted. |
| GET | `/api/v1/forms/students/{studentId}/status` | Per-form submission flags for reminder/link logic (e.g. "has the parent submitted their forms?"). Returns `forms.{preCounsellingStudent, preCounsellingParent, feedbackStudent, feedbackParent}` — each `{ submitted, submittedAt }` (a form counts only once **finalized**, not while a draft) — plus roll-ups `preCounsellingComplete` and `feedbackComplete` (both student+parent submitted). 404 if the student doesn't exist. |

`submittedByRole` (`STUDENT` vs `PARENT`) is derived automatically from `formType` —
not a request parameter — since each form type is filled by exactly one role.

`STUDENT_PROFILE` currently returns an empty question list on `GET .../{formType}` —
that content was modeled as first-class `Student` columns (father/mother details,
primary contact) instead of generic form questions; see `docs/db-design.md`.

**Workflow side effect**: finalizing (submit) both `PRE_COUNSELLING_STUDENT` and
`PRE_COUNSELLING_PARENT` for the same student advances their `workflowStatus` to
`PRE_COUNSELLING_FORMS_SUBMITTED` (only once both are in — submitting just one has no
effect).

**Project-window gate**: these forms are filled through a no-login link, so the write
endpoints (draft `PUT` and `submit`) are gated on the student's **Project window**. If
the project is `CLOSED` or past its `toDate` (end date — **inclusive of the whole day**,
so writes stay open through the end of that date and close at the start of the next day),
they return **403** with
`error.details.reason` = `PROJECT_CLOSED` \| `PROJECT_DELETED` \| `PROJECT_EXPIRED` (plus `projectId`,
`toDate`). Reads (`GET` template/submission/status) stay open so ended-cycle data is
still viewable.

## Assessment

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/assessment/questions` | List assessment questions for a cohort, ordered. Query: `cohort` (required), `section?` (`RIASEC` \| `BIG_FIVE` \| `APTITUDE` \| `COGNITIVE`). **`correctOption` is never included in the response** — it's the aptitude answer key and must not be exposed to whoever is taking the assessment. |
| POST | `/api/v1/assessment/score-preview` | **Staff, dev/QA only.** Run the scoring engine over ad-hoc answers with **no student/attempt/persistence** — purely to inspect the report a given answer pattern produces. Body: `cohort, answers: [{ fieldKey, response }]` (partial OK — unanswered Likert defaults to neutral, aptitude to incorrect), `durationMinutes?` (feeds the ORI band, default 30). Returns the full computed report. Backs the browser tester below. 404 for an unknown cohort. |
| POST | `/api/v1/assessment/attempts` | Start a new attempt, or resume the student's existing `IN_PROGRESS` one for the given cohort. Body: `studentId, cohort`. 200 either way (not 201 — may resume rather than create). 409 if the student already has a `SUBMITTED` attempt for this cohort. |
| GET | `/api/v1/assessment/attempts/{attemptId}` | Get an attempt with its answers (questions included, `correctOption` excluded). |
| PUT | `/api/v1/assessment/attempts/{attemptId}/answers` | Save/update answers ("Save Progress"). Body: `answers: [{ fieldKey, selectedOption, timeTakenMs? }]`. Upserts `AssessmentAnswer` rows; idempotent. 400 on an unknown `fieldKey`. 409 if the attempt is already submitted (locked). `timeTakenMs` (optional) is per-question elapsed time — send it for aptitude questions to enable the Time-Consistency component of ARI. |
| POST | `/api/v1/assessment/attempts/{attemptId}/submit` | Finalize an attempt. Validates every question in the cohort has an answer — 400 with `{ missingFieldKeys }` if not — then sets `status: SUBMITTED` + `submittedAt`, locks it, **and runs the scoring engine to compute + store the `AssessmentResult`**. 409 if already submitted. |
| GET | `/api/v1/assessment/attempts/{attemptId}/result` | Get the computed scoring report for a submitted attempt: 18 trait scores + grades, RIASEC/Big Five/Aptitude/Cognitive layer breakdowns with flags, Dominant Career Style (DCS) & Dominant Personality Style (DPS), Stream Fit (top 3), Graduation Pathways (top 3), Career Fit (top-6 domains with a representative career + top-3 industries), and the reliability dashboard (RVS, ACI, ORI, DC). 404 until the attempt is submitted. |

On submit, the scoring engine computes an `AssessmentResult` (see
`src/modules/assessment/scoring/`). **Fully computed today**: RIASEC / Big Five /
Aptitude / Cognitive trait scores, grades, tie-breaks and flags; DCS; DPS; Stream Fit;
Graduation Pathways; Career Fit (top-6 domains, each with a representative career picked
by highest AI-resilience, plus a top-3 industry rollup); and the RVS, ACI, ORI and
Difficulty-Consistency reliability measures. **Deferred pending PWC sign-off** (`null`
until resolved): Time-Consistency & the composite ARI (need per-question `timeTakenMs`).
See `docs/db-design.md`.

**Scoring tester (dev only):** with the API running (`pnpm dev`), open
`http://localhost:4000/dev/assessment` in a browser — a single self-contained page that
logs in, loads the question bank, lets you fill answers (with quick-fill / randomise
buttons), and renders the full computed report from `POST /assessment/score-preview`. No
student/attempt/DB writes. Served only when `NODE_ENV !== production`
(`public/assessment-tester.html`).

**Workflow side effect**: starting a student's first attempt for a cohort advances
`workflowStatus` to `ASSESSMENT_PENDING`; submitting it advances to
`ASSESSMENT_COMPLETED`.

**Project-window gate**: like the forms flow, the assessment is taken without a login, so
the write endpoints (start attempt, save answers, submit) are gated on the student's
Project window — **403** (`error.details.reason` = `PROJECT_CLOSED` \| `PROJECT_DELETED` \| `PROJECT_EXPIRED`)
once the project is closed or past its `toDate`. Reads (`GET` attempt/result) stay open.

## Career Library

Retrieval/search over the imported career library data (see `docs/db-design.md` →
"Career Library workbook import" for the data model and cross-table mapping). Reads =
any authenticated user; entry writes = admin; the ratification request flow lets
counsellors propose additions for admin review.

Entries have a `status` (`DRAFT`\|`ACTIVE`). New entries default to `DRAFT` and are hidden
from the default (ACTIVE-only) list until an admin publishes them by `PATCH`-ing
`status:ACTIVE`.

**Normalized links (select-or-add).** Entrance exams, courses, and institutions/colleges
are **canonical lookup tables** linked to each career (many-to-many). On create/update,
`entranceExams` / `courses` / `institutions` each take an array where every item is
**either** an existing row `{ id }` **or** a new one `{ name, … }` (find-or-create). Feed
the dropdowns from the typeahead endpoints below. (`topCompanies` and `certifications*`
remain free-text arrays for now; the old `String[]` exam/course columns are still
dual-written during the transition — see `docs/career-library-normalization-spec.md`.)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/career-library` | Search/list entries. Query: `search?` (free text across jobRole/oneLineDescription and the taxonomy names), `clusterId?, industryId?, domainId?` (filter by taxonomy id at any level; combining `clusterId`+`industryId` ANDs them), `aiResilienceGrade?` (`LOW`\|`MEDIUM`\|`HIGH`\|`VERY_HIGH`), `status?` (defaults to `ACTIVE`), `page?` (default 1), `pageSize?` (default 20, max 100). Each entry includes its `domain` chain (`domain.industry.cluster`) so the cluster/industry/domain names are still present. Returns `{ data, pagination: { page, pageSize, total, totalPages } }`. |
| GET | `/api/v1/career-library/filters` | Filter-dropdown source, now backed by the taxonomy tables (live rows only): `clusters` / `industries` / `domains` as `{id, name}` objects (industries carry `clusterId`, domains carry `industryId` for cascading) plus the fixed `aiResilienceGrades` list. For a fully nested picker use `GET /career-taxonomy/tree`. |
| GET | `/api/v1/career-library/entrance-exams` | **Typeahead dropdown.** Canonical entrance exams. Query: `search?`, `level?` (`UG`\|`PG`), `domainId?`, `limit?` (default 50). `domainId` scopes the list to exams already linked to job roles in that domain ("what this domain already has"); 400 if it isn't a live domain. Omit it for the global list. |
| GET | `/api/v1/career-library/institutions` | **Typeahead dropdown.** Canonical institutions/colleges. Query: `search?`, `domainId?`, `limit?`. `domainId` scopes to institutions already linked to job roles in that domain; 400 if it isn't a live domain. |
| GET | `/api/v1/career-library/courses` | **Typeahead dropdown.** Canonical courses. Query: `search?`, `level?`, `domainId?`, `limit?`. `domainId` scopes to courses already linked to job roles in that domain; 400 if it isn't a live domain. |
| POST | `/api/v1/career-library` | **Admin.** Create an entry. Required: `domainId` (a live `CareerDomain` leaf — cluster/industry are derived from it; 400 if unknown or soft-deleted), `jobRole, aiResilienceGrade, aiResilienceComment, oneLineDescription, qualification10th12th`. Optional: salary/qualification fields (incl. `qualification10th12thExplanation`, `qualificationGraduationDefined`, `qualificationPGDefined`), `roleOverview`, `keySkills` (string list), `topCompanies`, `certifications*`, `status` (default `DRAFT`), and the normalized links `entranceExams` / `courses` / `institutions` (each `[{ id } \| { name, … }]`; exam items need `level` when added by name). Returns the assembled entry. `createdBy` = calling admin. |
| PATCH | `/api/v1/career-library/{id}` | **Admin.** Partial update (any create field, incl. `status` toggle). A provided link array **replaces** that entry's links; omitting it leaves them unchanged. **Clearing a value:** omitting a scalar leaves it unchanged, sending `null` clears it — accepted for every nullable column (`salaryIndia*`/`salaryGlobal*` text **and** numeric, `roleOverview`, `qualification10th12thExplanation`, `qualificationGraduation(Defined)`, `qualificationPG(Defined)`, `entranceExamsUGDescription`). Empty strings are still rejected; clear with `null`. `jobRole`, `domainId`, `aiResilienceGrade`, `aiResilienceComment`, `oneLineDescription` and `qualification10th12th` are NOT NULL and reject `null`. Clear a list by sending `[]`. 400 on an unknown link `id`. Sets `updatedBy`. 404 if not found. |
| DELETE | `/api/v1/career-library/{id}` | **Admin.** Delete an entry (cascades its links; first detaches any request's `resultingEntryId`). 404 if not found. |
| GET | `/api/v1/career-library/{id}` | Get one entry. Includes the `domain` chain (`domain.industry.cluster`), the curated normalized links `linkedEntranceExams` / `linkedCourses` / `linkedInstitutions`, plus the legacy broad value-match view `relatedInstitutions` (by `domain.industry.name`) / `relatedCourses` (by `domain.industry.cluster.name`) / `relatedEntranceExams` (kept during transition). 404 if not found. |

### Ratification requests

Counsellors propose careers that aren't in the library; admins review. `CareerLibraryRequest`
status: `PENDING` → `APPROVED`\|`REJECTED`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/career-library/requests` | **Staff.** Submit a request. Body: `jobTitle, suggestedCluster, suggestedIndustry, suggestedDomain?, oneLineDescription, justification, referenceLinks?`. A counsellor is resolved as `requestedById` from their token; an admin filing on behalf passes `requestedById` (a counsellor id) explicitly. Created `PENDING`. |
| GET | `/api/v1/career-library/requests` | **Staff.** List requests (newest first, with any linked `resultingEntry`). Query: `status?, requestedById?`. |
| GET | `/api/v1/career-library/requests/{requestId}` | **Staff.** Get one request. 404 if not found. |
| POST | `/api/v1/career-library/requests/{requestId}/approve` | **Admin.** Approve. Body: `{ resultingEntryId? }` (link the entry the admin created from it). Sets `status:APPROVED`, `reviewedBy`, `reviewedAt`. 409 if already reviewed; 400 if `resultingEntryId` is unknown. |
| POST | `/api/v1/career-library/requests/{requestId}/reject` | **Admin.** Reject (no body). Sets `status:REJECTED`, `reviewedBy`, `reviewedAt`. 409 if already reviewed. |

## Career Taxonomy

Admin-managed classification hierarchy behind the career library: **Cluster → Industry → Domain**.
A `CareerLibraryEntry` references a `domainId` (the leaf). Reads = any authenticated user (feeds the
pickers); writes = **Admin**. Nodes are **soft-deleted** (`deletedAt`): a deleted node drops out of
the default lists/tree but its FK stays intact so existing job roles still resolve; restore reverses
it. Default lists show live rows only; pass `?includeDeleted=true` for admin management views.
Name uniqueness is enforced among **live** siblings, so a soft-deleted name can be reused (which then
makes restoring the original **409**). Ids may be cuid or uuid (backfilled rows).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/career-taxonomy/tree` | Full live hierarchy `clusters → industries → domains` (nested `{id, name, …}`), for the cascading "add job role" picker. |
| GET | `/api/v1/career-taxonomy/clusters` | List clusters. Query: `includeDeleted?`. |
| POST | `/api/v1/career-taxonomy/clusters` | **Admin.** Create. Body: `{ name }`. 409 if a live cluster has that name. |
| PATCH | `/api/v1/career-taxonomy/clusters/{id}` | **Admin.** Rename (`{ name? }`). Renames propagate to all entries via the relation. 409 on clash, 404 if missing/deleted. |
| DELETE | `/api/v1/career-taxonomy/clusters/{id}` | **Admin.** Soft-delete. Returns the node with `deletedAt` set. |
| POST | `/api/v1/career-taxonomy/clusters/{id}/restore` | **Admin.** Clear `deletedAt`. 409 if a live cluster now holds the name. |
| GET | `/api/v1/career-taxonomy/industries` | List industries. Query: `clusterId?, includeDeleted?`. |
| POST | `/api/v1/career-taxonomy/industries` | **Admin.** Create. Body: `{ clusterId, name }`. 404 if the cluster is missing/deleted; 409 on duplicate name within the cluster. |
| PATCH | `/api/v1/career-taxonomy/industries/{id}` | **Admin.** Rename and/or re-parent (`{ clusterId?, name? }`). 409 on clash within the target cluster. |
| DELETE | `/api/v1/career-taxonomy/industries/{id}` | **Admin.** Soft-delete. |
| POST | `/api/v1/career-taxonomy/industries/{id}/restore` | **Admin.** Restore. 409 on name clash. |
| GET | `/api/v1/career-taxonomy/domains` | List domains. Query: `industryId?, includeDeleted?`. |
| POST | `/api/v1/career-taxonomy/domains` | **Admin.** Create. Body: `{ industryId, name }`. 404 if the industry is missing/deleted; 409 on duplicate name within the industry. |
| PATCH | `/api/v1/career-taxonomy/domains/{id}` | **Admin.** Rename and/or re-parent (`{ industryId?, name? }`). 409 on clash within the target industry. |
| DELETE | `/api/v1/career-taxonomy/domains/{id}` | **Admin.** Soft-delete. |
| POST | `/api/v1/career-taxonomy/domains/{id}/restore` | **Admin.** Restore. 409 on name clash. |

## Sessions

Implements the blind, first-available-slot booking flow resolved in
`docs/session-scheduling-use-cases.md`. Institutes upload counsellor availability as a
discrete, per-date slot sheet once at project creation; Session 1 & 2 are booked
together, blind (no counsellor shown), with Session 2 locked to Session 1's assigned
counsellor and at least 2 calendar days later. No auth/role gating is implemented yet —
these endpoints are open like the rest of the API.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/sessions/slots/import` | One-time bulk import of a project's counsellor slot sheet. Body: `projectId, slots: [{ counsellorId, date, startTime, endTime }]`. 409 if the project already has slots imported (single upload, ever). 400 if any `counsellorId` isn't assigned to the project via `ProjectCounsellor`. |
| GET | `/api/v1/sessions/slots` | List counsellor slots (oversight). Query: `projectId?, counsellorId?, status?` (`OPEN`\|`BOOKED`). |
| GET | `/api/v1/sessions/students/{studentId}/booking-options` | Blind Session 1 options — deduped `{ slotDate, startTime, endTime }` list across all open slots for the student's project. Query: `sessionNumber` (`SESSION_1`\|`SESSION_2`). For `SESSION_2`, also pass `session1Date, session1StartTime` — resolves the counsellor that pick would assign (first-available, upload order) and returns only that counsellor's remaining open slots at least 2 calendar days after `session1Date`. |
| POST | `/api/v1/sessions/students/{studentId}/book` | Book Session 1 & 2 together, atomically. Body: `session1: { date, startTime }, session2: { date, startTime }`. Blind-assigns the counsellor from the first-available slot matching the Session 1 pick; Session 2's pick must belong to that same counsellor and be ≥2 calendar days later. Requires `workflowStatus >= ASSESSMENT_COMPLETED` — 400 otherwise. 409 if the student already has sessions booked, or if either slot was claimed by someone else in a race. Advances `workflowStatus` to `SESSION_SCHEDULED`. Sends `SESSION_SCHEDULED_CONFIRMATION_STUDENT`/`_PARENT`/`_COUNSELLOR` emails. |
| GET | `/api/v1/sessions/students/{studentId}` | List a student's sessions (dashboard cards). |
| GET | `/api/v1/sessions/counsellors/{counsellorId}` | List a counsellor's sessions (dashboard). Query: `status?`. |
| GET | `/api/v1/sessions/counsellors/{counsellorId}/my-students` | "My Students" — every student across the projects this counsellor is assigned to (via `ProjectCounsellor`), **not** just students they already have a booked session with. Query: `projectId?` (400 if the counsellor isn't assigned to it), `workflowStatus?`. Each entry: `id, studentCode, firstName, lastName, email, mobile, class, division, fatherName, motherName, parentMobile, parentEmail, workflowStatus, formsSubmitted, totalForms (4), assessmentSubmitted, sessions` (`sessions` is scoped to this counsellor — empty until they're actually assigned via a booked session). `formsSubmitted`/`totalForms` count `PRE_COUNSELLING_STUDENT`/`PRE_COUNSELLING_PARENT`/`FEEDBACK_STUDENT`/`FEEDBACK_PARENT` submissions — `STUDENT_PROFILE` isn't included (it's tracked via `workflowStatus`, not a form submission). |
| POST | `/api/v1/sessions` | Admin manual creation for edge cases outside self-service booking — bypasses the slot inventory entirely. Body: `studentId, counsellorId, sessionNumber, date, startTime, endTime`. If the student already has a `CANCELLED` session for that `sessionNumber`, this **reactivates that row in place** (new counsellor/date/time allowed, cancellation + join/no-show fields cleared) rather than inserting a second row — `@@unique([studentId, sessionNumber])` only allows one row per session number, so this is how an admin re-books after a cancellation with a different counsellor. 409 if an existing `SCHEDULED`/`COMPLETED` session for that number is still active. |
| GET | `/api/v1/sessions` | Admin oversight list. Query: `projectId?, instituteId?, studentId?, counsellorId?, status?, from?, to?` (date range on `scheduledDate`). |
| GET | `/api/v1/sessions/{id}` | Get one session. |
| PATCH | `/api/v1/sessions/{id}/meeting-link` | Manually set/replace `meetingLink` (plain string — no Calendly/Google Meet integration; also what's shared with the parent). Body: `{ meetingLink }` (URL). |
| POST | `/api/v1/sessions/{id}/join` | "Join Now" — records `studentJoinedAt`/`counsellorJoinedAt` and returns the `meetingLink`. Body: `{ role }` (`STUDENT`\|`COUNSELLOR`). Window: from 10 minutes before `startTime` through `endTime`; 400 outside that window. |
| POST | `/api/v1/sessions/{id}/complete` | Marks the session `COMPLETED` (the "Session Completed" confirmation button). Advances `workflowStatus` to `SESSION_1_COMPLETED` / `SESSION_2_COMPLETED`. |
| PATCH | `/api/v1/sessions/{id}/notes` | Counsellor adds/updates session notes — independent of the booking/join flow. Body: `{ notes }`. |
| POST | `/api/v1/sessions/{id}/reschedule` | Move to a new date/time for the same (already-locked) counsellor. Body: `{ date, startTime, initiatedBy }` (`STUDENT`\|`COUNSELLOR`\|`ADMIN`). `STUDENT`-initiated requests are rejected within 24 hours of the current `startTime` (skipped when reactivating a `CANCELLED` session — see below, since its old date is no longer meaningful). Re-validates the ≥2-day gap against the student's other session. Releases the old slot back to `OPEN`, claims the new one. Also works on a `CANCELLED` session — reactivates it back to `SCHEDULED` (clearing `cancellationReason`/`cancellationNotes`), still locked to the same counsellor, which is the "student re-books" path after a cancellation where the counsellor is unaffected. 409 if the session is `COMPLETED`. Sends `SESSION_RESCHEDULED_STUDENT`/`_PARENT`. |
| POST | `/api/v1/sessions/{id}/cancel` | Cancels a session and releases its slot back to `OPEN`. Body: `{ reason, notes?, initiatedBy }` (`reason`: `STUDENT_UNAVAILABLE`\|`COUNSELLOR_UNAVAILABLE`\|`INSTITUTION_REQUEST`\|`OTHER`). Sends `SESSION_CANCELLED_STUDENT`/`_PARENT`. |
| POST | `/api/v1/sessions/{id}/send-day-reminder` | Manually triggers the same-day reminder email to student + parent + counsellor (`SESSION_1_DAY_REMINDER_*` / `SESSION_2_DAY_REMINDER_*`, `*` = `STUDENT`\|`PARENT`\|`COUNSELLOR`). No scheduler/cron exists to fire this automatically — same gap as the rest of the Email module. Body: `{ portalLink? }`. |

**No-show tracking**: `studentNoShow`/`counsellorNoShow` are reconciled lazily — the
first read of a `SCHEDULED` session after its `endTime` has passed, with no matching
join timestamp, flips the flag (best-effort, doesn't block the read).

**Not implemented**: role-based access control (any caller can act as any role via the
`role`/`initiatedBy` body fields — there's no auth check that the caller actually is
that student/counsellor), real Calendly/Google Meet link generation, and automatic
(cron-driven) reminder sends.

## Counsellor Chart

The counsellor's working chart for a student — assembled live from the student profile,
both pre-counselling questionnaires (student + parent, side by side), the assessment
result, and flagged mirror pairs — plus the counsellor's own saved inputs. See
`docs/6.Class 910_Counsellor Form Chart.pdf`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/counsellor-chart/students/{studentId}` | Assemble the full chart: `ourChampion` (profile), `academicRecord`, `preCounselling` (4 sections of student-vs-parent parameter rows), `assessment` (the computed report), `flaggedMirrorPairs` (strong/gap-0 contradictions only), and `counsellor` (saved notes/SCRI/ratings). Lazily creates an empty chart row if none exists. 404 if the student doesn't exist. |
| PUT | `/api/v1/counsellor-chart/students/{studentId}` | Partial save of counsellor-authored content. Body (all optional): `notes` (`[{ code: "A1".."H4", body }]`, ≤10 lines each), `scri` (`{ confidence, reasonedThinking, reducedAnxiety, selfAwareness, careerCuriosity, decisionOwnership }`, each 1–4 — band recomputed), `academicTrend`, `alignmentRating`, `strengths`/`hobbies`/`careerShortlist`, `lastEditedBy`. |
| POST | `/api/v1/counsellor-chart/students/{studentId}/mirror-pair-amendments` | Amend a flagged mirror-pair answer. Body: `{ questionCode, amendedOption (1–5), counsellorId? }`. Overrides the student's response (original preserved) and **re-runs the full scoring engine**, returning the recomputed `AssessmentResult`. 400 if `questionCode` isn't a mirror-pair question; 404 if the student has no submitted assessment. |
| DELETE | `/api/v1/counsellor-chart/students/{studentId}/mirror-pair-amendments/{questionCode}` | Revert an amendment to the student's original answer and re-score. Returns the recomputed `AssessmentResult`. |

## Feedback (Counsellor Satisfaction Score)

Computes the Counsellor Satisfaction Score from the post-counselling feedback forms
(submitted via the Forms API as `FEEDBACK_STUDENT` / `FEEDBACK_PARENT`). Read-only —
the numbers are derived on demand from submitted forms per
`docs/10.Class 910_Feedback Form_Rating Methodology.pdf`; nothing is stored. Student
feedback is weighted 80%, parent 20%; each form's sections carry fixed weights.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/feedback/students/{studentId}/score` | One student's **Final Score %**. Returns section-by-section breakdown (average, %) for both forms, `student`/`parent` weighted score %, `finalPercent` (student×0.8 + parent×0.2), and the mapped `band` + `incentive`. **Both** feedback forms must be *submitted*; if not, returns `{ complete: false, missingForms: [...] }` (200, not an error). 404 only if the student doesn't exist. |
| GET | `/api/v1/feedback/counsellors/{counsellorId}/score` | The counsellor's **Overall Score %** — the average of their students' complete-pair Final Score %s (students linked via `Session`). Returns `totalStudents`, `includedStudents`, `excludedStudents` (incomplete pairs, excluded), the per-student `sessions` list, and `overall` (`overallPercent` + `band` + `incentive`), or `overall: null` if no student has a complete pair. |

Performance bands (applied to Final/Overall %): **90–100** Top Performer (₹1,000) ·
**80–89** Strong Performer (₹750) · **70–79** Needs Improvement (₹500) · **<70**
Critical (₹0). Lower-inclusive/upper-exclusive, top band fully inclusive.

## Reports

Assembles the student assessment report as one structured JSON payload — the frontend
renders the print/PDF view from it. Nothing new is computed here; it composes the already-
stored `AssessmentResult` report, the counsellor-authored `CounsellorChart` narrative, and
the feedback score into the report's sections. Access: student-or-staff, and a `STUDENT`
token may only read their own (it's the student-facing deliverable).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/reports/students/{studentId}/assessment` | The full student assessment report. Returns `student` (name, code, institute/class/division, workflowStatus), `championProfile` (DCS + DPS), `traitMap` (RIASEC / Big Five / Aptitude / Cognitive layers + flat 18-trait map), `careerCompass` (Career Fit top-6 domains with representative careers + top-3 industries), `streamFit`, `graduationPathways`, `reliability` (RVS/ACI/ORI/DC), `counsellorNarrative` (chart strengths/hobbies/shortlist/SCRI/notes, or `null` if none authored), `feedback` (score or `{ complete:false }`), and `meta` (cohort, `assessmentSubmittedAt`, `finalized`, engine `pending` list). **404 until the student has a computed assessment result.** |

## Email

Sends transactional email via a configurable provider (`EMAIL_PROVIDER` env var —
`console` logs instead of sending, the local-dev default; `mailgun` sends for real
through Mailgun's API). 40 templates: the 9 kREATE lifecycle communications from
`docs/11.Class 910_Communication EMail Templates.pdf`, plus 31 reminder/session-status
templates that are the email equivalents of `docs/Class 910_Workflow Prompts for
Watsapp.xlsx` (that sheet is WhatsApp copy — WhatsApp sending itself isn't
implemented). **Full reference, including every `templateKey` and its required `data`
fields: [`src/modules/email/README.md`](../src/modules/email/README.md).**

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/email/templates` | List all 37 available `templateKey` values. |
| POST | `/api/v1/email/send` | Render a template with merge `data` and send it. Body: `to` (email), `templateKey`, `data` (object — fields vary per template; 400 with `error.details.fieldErrors` if `data` doesn't match). Returns `202` with `{ providerMessageId, subject, provider }`. |

## Docs

| Method | Path | Description |
|---|---|---|
| GET | `/docs` | Swagger UI. |
| GET | `/docs/openapi.json` | Raw OpenAPI 3.0 spec. |

## Not yet built

For context on what's deliberately missing — see `CLAUDE.md` → "What's not built yet"
and `docs/db-design.md` → "Deliberate scope gaps". Notably: counsellor CRUD, project
CRUD, career library create/edit/delete + counsellor ratification-request flow,
report generation, and any route-level role-based access control (the Auth module issues
tokens, but nothing checks them yet). (Assessment scoring and the Counsellor Chart —
including mirror-pair amendments — are now built.)
