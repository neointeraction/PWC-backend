# API List

Live source of truth for every HTTP endpoint in this service. **Update this file in
the same change as any route added, removed, or modified** — it's the quick-reference
companion to the interactive Swagger UI.

- Interactive docs (Swagger UI): `GET /docs`
- Raw OpenAPI spec: `GET /docs/openapi.json`
- Base path for all API routes below: `/api/v1` (except `/health`, which is unprefixed)
- Auth: login/refresh/logout exist (see Auth section), but **no endpoint requires a
  token yet** — `authenticate`/`requireRole` middleware exists
  (`src/common/middlewares/auth.ts`) but isn't wired into any route. Every endpoint
  below is still open with no credentials, in dev.

Last updated: 2026-08-10 (after fixing two Sessions edge cases — rebooking after a
cancellation, and slot release on student deletion — see the `POST /sessions`,
`POST /sessions/{id}/reschedule`, and `DELETE /students/{id}` rows).

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

**Not wired up yet**: no route in any other module requires a token. The
`authenticate`/`requireRole` middleware (`src/common/middlewares/auth.ts`) is built and
ready, but applying it — and deciding which roles can hit which endpoint — is separate
follow-up work per module.

## Institutes

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/institutes` | Create an institute. Body: `name, address, contactNumber (E.164), primaryEmail`. All unique. |
| GET | `/api/v1/institutes` | List all institutes. |
| GET | `/api/v1/institutes/{id}` | Get one institute, including its classes/divisions. |
| PATCH | `/api/v1/institutes/{id}` | Update an institute (partial body, same fields as create). |
| DELETE | `/api/v1/institutes/{id}` | Delete an institute (cascades to its classes/divisions/projects). |
| POST | `/api/v1/institutes/{id}/classes` | Create a class under an institute. Body: `name`. |
| GET | `/api/v1/institutes/{id}/classes` | List an institute's classes (with their divisions). |
| POST | `/api/v1/institutes/{id}/classes/{classId}/divisions` | Create a division under a class. Body: `name`. |
| GET | `/api/v1/institutes/{id}/classes/{classId}/divisions` | List a class's divisions. |

## Students

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/students` | Create a student. Also creates a linked `User` (role `STUDENT`) with a generated temp password, returned once in the response. Body: `firstName, lastName, email, mobile, whatsappNumber?, studentCode, projectId, divisionId, parentMobile, parentEmail, fatherName, fatherOccupation, fatherEmployer?, motherName, motherOccupation, motherEmployer?`. |
| GET | `/api/v1/students` | List students. Query: `projectId?, divisionId?, workflowStatus?`. |
| GET | `/api/v1/students/{id}` | Get one student (with user, project, division). Includes `workflowStatus`. |
| PATCH | `/api/v1/students/{id}` | Update a student (partial body; validates `divisionId` still belongs to the student's project institute if changed). |
| DELETE | `/api/v1/students/{id}` | Delete a student (deletes the linked `User` too, which cascades). Also releases any `CounsellorSlot` still `BOOKED` by the student's sessions back to `OPEN` before the cascade deletes those `Session` rows — otherwise the slot would be stranded (`ON DELETE SET NULL` clears its `sessionId` but not its `status`), permanently unbookable. |
| POST | `/api/v1/students/{id}/confirm-profile` | Student confirms their profile data (father/mother details, parent contact) is correct. Advances `workflowStatus` `DRAFT → PROFILE_COMPLETED`. 409 if not currently `DRAFT`. |
| PATCH | `/api/v1/students/{id}/workflow-status` | Admin/ops override — sets `workflowStatus` directly (not forward-only, unlike the automatic triggers below). Body: `{ workflowStatus }`. Covers the stages not yet wired to a real trigger (Sessions, Counsellor Chart/Feedback, Reports don't exist as modules yet). |

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
`error.details.reason` = `PROJECT_CLOSED` \| `PROJECT_EXPIRED` (plus `projectId`,
`toDate`). Reads (`GET` template/submission/status) stay open so ended-cycle data is
still viewable.

## Assessment

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/assessment/questions` | List assessment questions for a cohort, ordered. Query: `cohort` (required), `section?` (`RIASEC` \| `BIG_FIVE` \| `APTITUDE` \| `COGNITIVE`). **`correctOption` is never included in the response** — it's the aptitude answer key and must not be exposed to whoever is taking the assessment. |
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

**Workflow side effect**: starting a student's first attempt for a cohort advances
`workflowStatus` to `ASSESSMENT_PENDING`; submitting it advances to
`ASSESSMENT_COMPLETED`.

**Project-window gate**: like the forms flow, the assessment is taken without a login, so
the write endpoints (start attempt, save answers, submit) are gated on the student's
Project window — **403** (`error.details.reason` = `PROJECT_CLOSED` \| `PROJECT_EXPIRED`)
once the project is closed or past its `toDate`. Reads (`GET` attempt/result) stay open.

## Career Library

Read-only retrieval/search over the imported career library data (see
`docs/db-design.md` → "Career Library workbook import" for the data model and
cross-table mapping). No write endpoints (create/edit/delete, or the counsellor
ratification request flow) yet.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/career-library` | Search/list entries. Query: `search?` (free text across jobRole/cluster/industry/domain/oneLineDescription), `cluster?, industry?, domain?, aiResilienceGrade?` (`LOW`\|`MEDIUM`\|`HIGH`\|`VERY_HIGH`), `status?` (defaults to `ACTIVE`), `page?` (default 1), `pageSize?` (default 20, max 100). Returns `{ data, pagination: { page, pageSize, total, totalPages } }`. |
| GET | `/api/v1/career-library/filters` | Distinct `clusters`, `industries`, `domains` (from `ACTIVE` entries) plus the fixed `aiResilienceGrades` list — for populating UI filter dropdowns. |
| GET | `/api/v1/career-library/{id}` | Get one entry, plus `relatedInstitutions` (`UgInstitution` rows matching the entry's `industry`), `relatedCourses` (`UgCourse` rows matching `cluster`), and `relatedEntranceExams` (`UgEntranceExam` rows matching the extracted UG `entranceExams` list). 404 if not found. |

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
