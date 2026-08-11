# Frontend Integration Guide

For the frontend team integrating against this API. Covers what exists today, exact
request/response shapes, and — just as important — what doesn't exist yet so you
don't build against endpoints that aren't there. This is a companion to
[`docs/api-list.md`](./api-list.md) (terse endpoint reference, kept up to date on
every change) and the interactive Swagger UI; start here for the "how do I actually
call this" details, use those for the day-to-day quick lookup.

**Status: pre-alpha backend.** Login/refresh/logout exist (§2), but **no other route
requires a token yet** — every endpoint below still works with no credentials at all.
Some write flows (career library management, reports, counsellor/project CRUD) don't
exist yet, and the shapes below can still change as we build out the remaining
modules. Treat this as a moving target — check `docs/api-list.md`'s "Last updated"
line and re-read before starting new integration work.

---

## 1. Base setup

- **Local dev base URL**: `http://localhost:4000` (port from `PORT` env var, default
  `4000`)
- **All API routes are prefixed `/api/v1`**, except `GET /health` which is
  unprefixed.
- **Content type**: `application/json` for all request bodies and responses.
- **Auth**: `POST /auth/login` exists and returns a real access token + sets a refresh
  cookie (§2) — but **no other route checks it**. You can build login UI against it
  now; just don't expect it to gate access to anything else yet.
- **CORS**: allowed origin is controlled by the backend's `CORS_ORIGIN` env var
  (defaults to `http://localhost:3000` in dev). Tell the backend team your dev server
  port if it's different.
- **Interactive docs**: `GET /docs` (Swagger UI), raw spec at `GET /docs/openapi.json`
  — useful for exploring request/response schemas interactively, though the
  descriptions there are intentionally terse; this doc has the fuller picture.

---

## 2. Auth

Base path: `/api/v1/auth`. JWT access token (short-lived, returned in the response
body — put it in an `Authorization: Bearer <token>` header once routes actually start
checking it) + refresh token (long-lived, httpOnly cookie, rotated on every use — you
never read or store it directly, the browser just carries the cookie).

**No self-register endpoint.** Every `User` — Student, Counsellor, Super Admin — is
created by an admin action or a seed script with a generated/configured temp password,
never by a public signup form. Don't build a "create account" screen against this API.

### 2.1 Login

`POST /login` — body `{ "email": "...", "password": "..." }`.
```json
{
  "accessToken": "eyJhbGciOi...",
  "user": {
    "id": "cm...",
    "email": "superadmin@kreate.local",
    "role": "SUPER_ADMIN",
    "firstName": "Super",
    "lastName": "Admin",
    "mustChangePassword": true
  }
}
```
Also sets an httpOnly `refreshToken` cookie (path `/api/v1/auth`, so it's only ever
sent back on `/refresh` and `/logout` calls — make sure your HTTP client sends cookies,
e.g. `credentials: "include"` with `fetch`). **401** on wrong password, unknown email,
or a deactivated (`isActive: false`) account — same generic "Invalid email or
password" message in every case, don't build UI that tries to distinguish them.

`mustChangePassword` is `true` for every admin/seed-created account (including the
seeded Super Admin) — there's no forced-password-change endpoint yet, so treat this as
a flag to show a "please change your password" nudge, not something the backend
enforces.

### 2.2 Refresh

`POST /refresh` — no body, relies entirely on the `refreshToken` cookie. Returns a new
`{ accessToken, user }` and rotates the cookie. **401** if the cookie is missing,
expired, or was already used once (rotation makes each refresh token single-use) — on
401 here, treat the session as fully logged out and send the user back to login, don't
retry.

### 2.3 Logout

`POST /logout` — no body, reads the `refreshToken` cookie, revokes it, clears the
cookie. **204** always, even with no cookie present (idempotent — safe to call from a
generic "sign out" button without checking session state first).

### 2.4 What's NOT built yet

- **No route actually requires the access token.** Every other endpoint in this doc
  (Institutes, Students, Sessions, etc.) is still completely open — sending or not
  sending the `Authorization` header makes no difference today. The
  `authenticate`/`requireRole` middleware exists on the backend but isn't wired into
  any route yet.
- **No password-reset/forgot-password flow.**
- **No "change password" endpoint** — `mustChangePassword` is informational only.

## 3. Error response contract

Every non-2xx response has this shape:

```json
{
  "error": {
    "message": "Human-readable summary",
    "details": {}
  }
}
```

`details` is optional and varies by error type:

- **400 — Zod validation failure** (malformed/missing request fields):
  ```json
  {
    "error": {
      "message": "Validation failed",
      "details": {
        "formErrors": [],
        "fieldErrors": { "cohort": ["Required"] }
      }
    }
  }
  ```
- **400 — business-rule failure** (e.g. missing required form answers), `details`
  shape is specific to the endpoint — documented per-endpoint below, e.g.
  `{ "missingFieldKeys": [...] }`.
- **404 — not found**: `{ "error": { "message": "Student not found" } }` (no `details`).
- **409 — conflict**: duplicate unique field, or an already-locked
  submission/attempt being written to again. `details` may include which field
  conflicted, e.g. `{ "fields": ["primaryEmail"] }`.
- **500**: `{ "error": { "message": "Internal server error" } }` (plus a `stack` field
  outside production, for debugging — never present in prod).

**Practical implication**: always branch on HTTP status first, then read
`error.message` for display and `error.details` for field-level handling (e.g.
highlighting which form fields are missing).

## 4. Conventions to know before you start

- **IDs** are `cuid`s (opaque strings like `"cmsegbt740000v0t3mleia6yv"`), not
  sequential integers. Never parse or assume structure — treat as opaque.
- **Timestamps** are ISO 8601 strings (`"2026-08-05T13:26:24.340Z"`).
- **Phone numbers** must be E.164 format on the way in (`+919876543210`) — the API
  rejects anything else with a 400.
- **Enums** are UPPER_SNAKE_CASE strings — see each module's enum list below. Match
  them exactly (case-sensitive) when sending values.
- **List endpoints** mostly return a bare array — **except** Career Library, which is
  paginated (`{ data, pagination }`). Check each endpoint below.
- **Nothing is soft-deleted** unless documented — `DELETE` endpoints are real deletes
  (with cascades noted per-endpoint).

---

## 5. Institutes

Base path: `/api/v1/institutes`

| Method | Path | Body / Query |
|---|---|---|
| POST | `/` | `{ name, address, contactNumber, primaryEmail }` — all required, all unique |
| GET | `/` | — (no filters, no pagination — returns all institutes) |
| GET | `/{id}` | — |
| PATCH | `/{id}` | any subset of the POST body fields |
| DELETE | `/{id}` | — cascades to the institute's classes/divisions/projects |
| POST | `/{id}/classes` | `{ name }` |
| GET | `/{id}/classes` | — returns classes with their `divisions` nested |
| POST | `/{id}/classes/{classId}/divisions` | `{ name }` |
| GET | `/{id}/classes/{classId}/divisions` | — |

**Create request example:**
```json
{
  "name": "Sunrise Public School",
  "address": "12 MG Road, Bengaluru",
  "contactNumber": "+919876543210",
  "primaryEmail": "admin@sunrisepublic.example"
}
```

**Response** (POST/GET single) is the raw institute row:
```json
{
  "id": "cm...",
  "name": "Sunrise Public School",
  "address": "12 MG Road, Bengaluru",
  "contactNumber": "+919876543210",
  "primaryEmail": "admin@sunrisepublic.example",
  "createdAt": "2026-08-05T...",
  "updatedAt": "2026-08-05T..."
}
```
`GET /{id}` additionally nests `classes: [{ ...class, divisions: [...] }]`.

**Note**: there's no `Project` endpoint yet (see §13), but `Student.projectId`
references one — for now, get a project ID from whoever seeds/creates it directly in
the DB, or wait for the Project module.

---

## 6. Students

Base path: `/api/v1/students`

| Method | Path | Body / Query |
|---|---|---|
| POST | `/` | see below |
| GET | `/` | query: `projectId?`, `divisionId?`, `workflowStatus?` |
| GET | `/{id}` | — |
| PATCH | `/{id}` | partial body, same fields as create minus `email`/`studentCode`/`projectId` (immutable) |
| DELETE | `/{id}` | deletes the linked `User` too (cascades) — also releases any `CounsellorSlot` the student's sessions had booked back to `OPEN`, so deleting a student never strands a slot |
| POST | `/{id}/confirm-profile` | no body — student confirms their profile data is correct |
| PATCH | `/{id}/workflow-status` | `{ workflowStatus }` — admin/ops override, see below |

**Create request** — all fields required unless marked optional:
```json
{
  "firstName": "Aditi",
  "lastName": "Rao",
  "email": "aditi.rao@example.com",
  "mobile": "+919876500001",
  "whatsappNumber": "+919876500002",
  "studentCode": "CB1",
  "projectId": "cm...",
  "divisionId": "cm...",
  "parentMobile": "+919876500003",
  "parentEmail": "parent-aditi@example.com",
  "fatherName": "Ramesh Rao",
  "fatherOccupation": "Engineer",
  "fatherEmployer": "Acme Corp",
  "motherName": "Sunita Rao",
  "motherOccupation": "Doctor",
  "motherEmployer": "City Hospital"
}
```
`whatsappNumber`, `fatherEmployer`, `motherEmployer` are optional. Everything else is
required.

**Create response** — note the shape is `{ student, tempPassword }`, not just the
student:
```json
{
  "student": {
    "id": "cm...",
    "studentCode": "CB1",
    "mobile": "+919876500001",
    "whatsappNumber": "+919876500002",
    "parentMobile": "+919876500003",
    "parentEmail": "parent-aditi@example.com",
    "fatherName": "Ramesh Rao",
    "fatherOccupation": "Engineer",
    "fatherEmployer": "Acme Corp",
    "motherName": "Sunita Rao",
    "motherOccupation": "Doctor",
    "motherEmployer": "City Hospital",
    "workflowStatus": "DRAFT",
    "user": { "id": "cm...", "email": "aditi.rao@example.com", "firstName": "Aditi", "lastName": "Rao", "isActive": true },
    "project": { "id": "cm...", "name": "...", "instituteId": "cm..." },
    "division": { "id": "cm...", "name": "A", "class": { "id": "cm...", "name": "Grade 9", "instituteId": "cm..." } }
  },
  "tempPassword": "aB3xK9pQ..."
}
```
**`tempPassword` is shown exactly once**, in this response — there's no "forgot
password"/resend flow yet (§2.4). If you lose it, someone will need to regenerate it
directly against the DB for now.

`workflowStatus` is one of: `DRAFT`, `PROFILE_COMPLETED`,
`PRE_COUNSELLING_FORMS_SUBMITTED`, `ASSESSMENT_PENDING`, `ASSESSMENT_COMPLETED`,
`SESSION_SCHEDULED`, `SESSION_1_COMPLETED`, `COUNSELLOR_FEEDBACK_REPORT`,
`SESSION_2_COMPLETED`, `COUNSELLOR_FEEDBACK`, `STUDENT_PARENT_FEEDBACK`, `CLOSED` — a
strictly forward-moving sequence.

GET responses use the same nested shape (`user`, `project`, `division`) minus
`tempPassword`.

### 6.1 Workflow status — how it advances

The first five stages now advance automatically as real actions happen — you don't
call anything extra, just watch `workflowStatus` change on subsequent `GET`s:

| Stage reached | What triggers it |
|---|---|
| `DRAFT` | Student created (§6, `POST /`) |
| `PROFILE_COMPLETED` | Student calls `POST /students/{id}/confirm-profile` |
| `PRE_COUNSELLING_FORMS_SUBMITTED` | Both `PRE_COUNSELLING_STUDENT` and `PRE_COUNSELLING_PARENT` forms submitted (§7.2) |
| `ASSESSMENT_PENDING` | Student's first assessment attempt started (§8.2) |
| `ASSESSMENT_COMPLETED` | Assessment attempt submitted (§8.3) |
| `SESSION_SCHEDULED` | Both sessions booked, `POST /sessions/students/{studentId}/book` (§10.4) |
| `SESSION_1_COMPLETED` | Session 1 marked complete, `POST /sessions/{id}/complete` (§10.9) |
| `SESSION_2_COMPLETED` | Session 2 marked complete, `POST /sessions/{id}/complete` (§10.9) |

**`POST /students/{id}/confirm-profile`** — no body. 200 with the updated student on
success. **409** if `workflowStatus` isn't currently `DRAFT` (i.e. already confirmed —
this is a one-time action, not idempotent-safe to call blindly; check the current
status first if you're not sure).

The remaining 4 stages (`COUNSELLOR_FEEDBACK_REPORT`, `COUNSELLOR_FEEDBACK`,
`STUDENT_PARENT_FEEDBACK`, `CLOSED`) depend on modules that don't exist yet (Counsellor
Chart/Feedback, Reports — see §13) — nothing advances them automatically. Until those
are built, **`PATCH /students/{id}/workflow-status`** (body: `{ "workflowStatus":
"COUNSELLOR_FEEDBACK_REPORT" }`, any valid enum value) is the only way to move a
student through them — this is an unrestricted admin/ops override (not forward-only
like the automatic triggers), meant for manual ops use, not something to wire into a
normal student/parent-facing UI.

---

## 7. Forms

Base path: `/api/v1/forms`. Covers the pre-counselling and feedback questionnaires —
**not** a generic CMS; content is fixed per `formType` + `cohort`.

`formType` values: `STUDENT_PROFILE`, `PRE_COUNSELLING_STUDENT`,
`PRE_COUNSELLING_PARENT`, `FEEDBACK_STUDENT`, `FEEDBACK_PARENT`.
Currently seeded cohort: `"CLASS_9_10"` (this is a free-text string, not an enum —
ask the backend team before assuming other cohort values exist).

`STUDENT_PROFILE` has **no questions** — that content lives on the `Student` record
directly (father/mother details, contact info — see §6), not as a form. Fetching it
returns a template with `questions: []`; don't render an empty form, just skip it.

### 7.1 Get a form template (the questions to render)

`GET /{formType}?cohort=CLASS_9_10`

```json
{
  "id": "cm...",
  "formType": "PRE_COUNSELLING_STUDENT",
  "cohort": "CLASS_9_10",
  "version": 1,
  "isActive": true,
  "createdAt": "2026-08-04T...",
  "questions": [
    {
      "id": "cm...",
      "order": 1,
      "questionCode": "Q1",
      "fieldKey": "academic_record_table",
      "sectionLabel": "Section 1 — My Academic Record",
      "questionText": "Fill in your marks or grade for the last three years.",
      "helpText": "This is not to evaluate you based on marks, but to know what you may like or dislike.",
      "questionType": "MATRIX",
      "options": { "rows": [...], "fields": [...] },
      "allowOtherText": false,
      "otherTextFieldKey": null,
      "isRequired": true
    }
  ]
}
```

`questionType` — how to render each question:

| Type | Render as | `options` shape |
|---|---|---|
| `MCQ_SINGLE` | radio group | `[{ value, label }]` |
| `MCQ_MULTI` | checkbox group | `[{ value, label }]` |
| `SHORT_TEXT` | single-line input | `null` |
| `OPEN_TEXT` | textarea | `null` |
| `NUMBER` | number input | `null` |
| `SCALE` | 1–5 rating scale | `[{ value: "1"..."5", label }]` |
| `MATRIX` | table/grid | `{ rows?: [{key,label}], fields: [{key,label,type,options?}] }` — see below |

`MATRIX` questions represent a whole table as **one** question. If `options.rows` is
present, it's a grid (cross product of rows × fields — e.g. one row per subject, one
column per data point). If `rows` is absent, `fields` are just several related inputs
grouped together (e.g. "favourite subject" + "why"). Either way, the **answer you
submit for a MATRIX question is a single JSON object** keyed by the sub-field keys
(see 6.2).

`allowOtherText: true` means the question has an "Any Other: ___" choice —
`otherTextFieldKey` names the companion free-text field to submit alongside the
selected option (submitted as a *separate* answer entry with that `fieldKey`).

### 7.2 Save a draft / submit answers

Answers are always submitted the same shape — an array of `{ fieldKey, answer }`.
`fieldKey` must match a `fieldKey` from the template's `questions[]`.

- **`MCQ_SINGLE`**: `answer` = the selected option's `value` string.
- **`MCQ_MULTI`**: `answer` = array of selected `value` strings.
- **`SHORT_TEXT` / `OPEN_TEXT`**: `answer` = string.
- **`NUMBER`**: `answer` = number.
- **`SCALE`**: `answer` = the selected value string (e.g. `"4"`).
- **`MATRIX`**: `answer` = a single JSON object keyed by the sub-field key(s) from
  that question's `options`.
  - **No `rows`** (a flat compound question, e.g. "favourite subject" + "why"):
    key directly by each field's `key`.
    ```json
    { "fieldKey": "fav_subject_block", "answer": { "fav_subject": "Mathematics", "fav_subject_reason": "a" } }
    ```
  - **With `rows`** (a grid, e.g. per-subject marks table): key by row `key`, each
    value itself an object keyed by field `key`.
    ```json
    {
      "fieldKey": "academic_record_table",
      "answer": {
        "english": { "c7": "78", "c8": "82", "c9": "85", "fav": "Y", "hard": "N" },
        "maths":   { "c7": "65", "c8": "70", "c9": "74", "fav": "N", "hard": "Y" }
      }
    }
    ```
    Rows the student leaves blank can simply be omitted from the object — you don't
    need to send every row, only the ones with data.

**Save draft** (idempotent, call as often as you like):
```
PUT /{formType}/students/{studentId}
```
```json
{
  "cohort": "CLASS_9_10",
  "answers": [
    { "fieldKey": "career_in_mind", "answer": "Still Exploring" },
    { "fieldKey": "fav_subject_reason", "answer": "b" }
  ]
}
```
Returns the updated `FormSubmission` with `submittedAt: null` and its `answers[]`
(each answer includes the full `question` object nested, so you can re-render without
a second fetch).

**Submit (finalize + lock)**:
```
POST /{formType}/students/{studentId}/submit
```
Same body shape as the draft `PUT` — answers here are merged with anything already
saved as a draft. On success, `submittedAt` is set and the submission is **locked**:
any further `PUT` or `POST .../submit` to it returns **409**.

**Project-window gate (no-login expiry).** Because these forms are filled via a shared
link with no login, both writes — draft `PUT` and `POST .../submit` — are gated on the
student's **Project window**. Once the project is `CLOSED` or past its end date (`toDate`,
inclusive — writes stay open through the whole of the end date and close the next day),
they return **403**:
```json
{ "error": { "message": "This project has ended — submissions are closed (ended 2025-12-31).",
  "details": { "reason": "PROJECT_EXPIRED", "projectId": "...", "toDate": "2025-12-31T00:00:00.000Z", "status": "CLOSED" } } }
```
`reason` is `PROJECT_EXPIRED` (past `toDate`) or `PROJECT_CLOSED` (manually closed). Show
an "this link has expired" screen — don't retry. Reads (template/submission/status) stay
open. The same gate applies to the assessment write endpoints (§8.3).

If any `isRequired` question has no answer, you get **400**:
```json
{
  "error": {
    "message": "Missing required answers",
    "details": { "missingFieldKeys": ["career_in_mind", "programme_expectations"] }
  }
}
```
Use that list to highlight the specific unanswered fields.

**Fetch an existing submission** (to resume a draft, or display a submitted form
read-only):
```
GET /{formType}/students/{studentId}?cohort=CLASS_9_10
```
Returns the same shape as the write endpoints. **404 if nothing's been saved yet** —
treat that as "show a blank form", not an error state.

`submittedByRole` (`STUDENT` vs `PARENT`) is inferred automatically from `formType` —
you never send it.

### 7.3 Form submission status (for reminders / parent links)

```
GET /forms/students/{studentId}/status
```
One call tells you which forms a student and their parent have **submitted** (finalized
— a saved-but-not-submitted draft counts as *not* submitted). Use it to decide whether
to send/remind the parent's pre-counselling or feedback link.

```json
{
  "studentId": "cm...",
  "forms": {
    "preCounsellingStudent": { "submitted": true,  "submittedAt": "2026-08-05T..." },
    "preCounsellingParent":  { "submitted": false, "submittedAt": null },
    "feedbackStudent":       { "submitted": false, "submittedAt": null },
    "feedbackParent":        { "submitted": false, "submittedAt": null }
  },
  "preCounsellingComplete": false,
  "feedbackComplete": false
}
```
`preCounsellingComplete` / `feedbackComplete` are `true` only when **both** the student
and parent side are submitted. 404 if the student doesn't exist.

---

## 8. Assessment

Base path: `/api/v1/assessment`. The psychometric assessment (RIASEC, Big Five,
Aptitude, Cognitive sections), cohort `"CLASS_9_10"` currently seeded, 73 questions
total.

### 8.1 Get the question bank

`GET /questions?cohort=CLASS_9_10&section=APTITUDE` (`section` optional: `RIASEC` |
`BIG_FIVE` | `APTITUDE` | `COGNITIVE`)

Returns a flat array, ordered:
```json
[
  {
    "id": "cm...",
    "cohort": "CLASS_9_10",
    "section": "APTITUDE",
    "order": 45,
    "questionCode": "Q45",
    "fieldKey": "aptitude_numerical_nr1",
    "questionText": "A shopkeeper sells a pen for ₹30, making a profit of 20%...",
    "format": "MCQ_SINGLE",
    "options": [{ "value": "A", "label": "A. ₹22" }, ...],
    "trait": "NUMERICAL",
    "traitCode": "NR1",
    "difficulty": "EASY",
    "weight": 1
  }
]
```
`format` is `LIKERT_5` (render a 1–5 agreement scale, `options` is `null` — the scale
is always fixed, label it yourself: 1 Strongly Disagree → 5 Strongly Agree) or
`MCQ_SINGLE` (render the given `options`).

**`correctOption` is deliberately never included in this response** — don't expect
it, and don't build any "check my answer" UI against this endpoint; there's no
scoring yet (see §13).

### 8.2 Start / resume an attempt

```
POST /attempts
```
```json
{ "studentId": "cm...", "cohort": "CLASS_9_10" }
```
Returns **200** either way — this call is idempotent-ish: if the student already has
an `IN_PROGRESS` attempt for that cohort, you get that same one back (resume);
otherwise a new one is created. **409** if the student already has a `SUBMITTED`
attempt for this cohort — the assessment can only be taken once.

```json
{
  "id": "cm...",
  "studentId": "cm...",
  "cohort": "CLASS_9_10",
  "status": "IN_PROGRESS",
  "startedAt": "2026-08-05T...",
  "submittedAt": null,
  "answers": []
}
```

### 8.3 Save answers / submit

```
PUT /attempts/{attemptId}/answers
```
```json
{ "answers": [{ "fieldKey": "riasec_realistic_r1", "selectedOption": "3", "timeTakenMs": 4200 }] }
```
`selectedOption` is a Likert value string (`"1"`–`"5"`) or an MCQ option letter
(`"A"`–`"E"`, where `"E"` = "Not sure"). Idempotent, call repeatedly as the student
progresses (implements "Save Progress"). 409 if the attempt is already `SUBMITTED`.

`timeTakenMs` is **optional** but **please send it for aptitude questions** — it's the
time the student spent on that question, and it powers the Time-Consistency half of the
aptitude reliability score (ARI). Until you send it, ARI/Time-Consistency stay `null`
in the result; everything else scores without it.

```
POST /attempts/{attemptId}/submit
```
No body. Validates **every** question in the cohort has an answer (unlike Forms,
there's no per-question "optional" flag — all 73 are required) — 400 with
`{ missingFieldKeys: [...] }` if incomplete, otherwise sets `status: "SUBMITTED"`,
locks it, **and computes + stores the scoring report**.

**Project-window gate (no-login expiry).** Starting an attempt (§8.2), saving answers,
and submitting are all gated on the student's Project window — same **403** contract as
Forms (§7.2): `reason` = `PROJECT_EXPIRED` \| `PROJECT_CLOSED` once the project is past
`toDate` or closed. Reads stay open.

```
GET /attempts/{attemptId}
```
Fetch current state (answers include the nested `question`, `correctOption` still
excluded). Use this to resume/render a saved attempt.

### 8.4 Results

```
GET /attempts/{attemptId}/result
```
Available once the attempt is `SUBMITTED` (404 before that). Returns the computed
report backing the Career kREATE output:

```json
{
  "attemptId": "cm...",
  "traitScores": { "REALISTIC": 60, "INVESTIGATIVE": 80, "...": "... all 18 traits" },
  "recommendedStreams": ["Humanities with Psychology", "...", "..."],
  "dominantCareerStyle": "Technical Investigator",
  "dominantPersonalityStyle": "Innovative Planner",
  "report": {
    "riasec":    { "scores": [{ "trait": "REALISTIC", "score": 60, "level": "Fairly Good", "traitName": "Applied Thinker", "..." : "..." }], "ranking": ["INVESTIGATIVE", "..."], "flags": [] },
    "bigFive":   { "scores": ["..."], "ranking": ["..."], "flags": [] },
    "aptitude":  { "scores": ["..."], "ranking": ["..."], "flags": [] },
    "cognitive": { "scores": ["..."], "ranking": ["..."], "flags": [] },
    "dominantCareerStyle":     { "code": "RIA", "style": "Technical Investigator", "description": "...", "explanation": "..." },
    "dominantPersonalityStyle":{ "code": "O-C", "style": "Innovative Planner", "description": "...", "explanation": "..." },
    "streamFit": { "top3": [{ "subStream": "...", "fitScore": 72.5, "level": "Good Fit", "..." : "..." }], "ranked": ["... all sub-streams"] },
    "graduationPathways": { "top3": [{ "subStream": "B.Des", "fitScore": 76.75, "level": "Strong Fit", "keyExams": "...", "eligibility": "...", "..." : "..." }], "ranked": ["... all 72"] },
    "careerFit": {
      "top3Industries": [{ "cluster": "...", "industry": "Design, Animation & Graphics", "domain": "Animation", "fitScore": 76.5, "level": "Strong Fit", "..." : "..." }],
      "top6Domains": [{
        "industry": "Design, Animation & Graphics", "domain": "Animation", "fitScore": 76.5, "level": "Strong Fit",
        "representativeCareer": { "jobRole": "...", "cluster": "...", "domain": "...", "aiResilienceGrade": "HIGH", "aiResilienceComment": "...", "oneLineDescription": "...", "topCompanies": ["..."], "salaryIndiaRangeText": "...", "salaryGlobalRangeText": "..." }
      }],
      "rankedDomains": ["... all scorable domains"]
    },
    "reliability": {
      "ari": { "dc": 100, "tc": null, "ari": null, "timingAvailable": false },
      "aci": { "dkPercent": 0, "level": "High Confidence", "..." : "..." },
      "ori": { "completionMinutes": 30, "level": "High Reliability", "..." : "..." },
      "rvs": { "score": 90, "level": "Highly Consistent Profile", "contradictionCount": 1, "mildCount": 0, "strongCount": 1, "pairs": ["... per-pair breakdown"], "..." : "..." }
    },
    "meta": { "computedAt": "2026-08-10T...", "timingAvailable": false, "pending": ["timeConsistency", "ari", "careerFit"] }
  }
}
```

**What's live vs. pending.** Everything the report needs is computed except the
composite ARI: trait scores + grades, DCS, DPS, Stream Fit, **Graduation Pathways**,
**Career Fit** (top-6 domains each with a `representativeCareer`, plus a top-3 industry
rollup for the "Industry Choice" table), and the RVS (EIM) / ACI / ORI /
Difficulty-Consistency measures. You can build the Trait Map, Champion's Profile, Stream
Fit, Graduation Pathways, Career Compass and most of the Reliability Dashboard now. The
only thing still in `report.meta.pending` is `ari`/`tc` (the composite ARI — `null` until
you send per-question `timeTakenMs`). Render that tile defensively (hide when `null`).
`careerFit` is `null` only if the career library is empty.

**Fit-qualifying threshold (recommendations).** The surfaced recommendation lists —
`streamFit.top3`, `graduationPathways.top3`, and `careerFit.top6Domains` /
`careerFit.top3Industries` — only include options whose **Fit Score is ≥ 60** ("Good Fit"
or "Strong Fit"). Per the report methodology, a "Weak Fit" option (< 60) "would not have
been considered", so weak fits are dropped from these lists. This means each list can be
**shorter than its name suggests** — `top3` may return 0–3 items and `top6Domains` may
return 0–6. `recommendedStreams` mirrors `streamFit.top3` and can likewise be shorter than
3 (or empty). Drive your UI off the array length, don't assume a fixed count, and handle
the empty case (no qualifying recommendation → prompt for counsellor review). The full,
unfiltered lists are still available under `streamFit.ranked`, `graduationPathways.ranked`,
and `careerFit.rankedDomains` if you need to show every scored option with its grade.

---

## 9. Career Library

Base path: `/api/v1/career-library`. Read-only browse/search over ~1,300 career
entries plus related UG/PG institution, course, and entrance-exam reference data.

### 9.1 Search / list

`GET /?search=&cluster=&industry=&domain=&aiResilienceGrade=&status=&page=&pageSize=`

All query params optional. `search` does a free-text match across job role, cluster,
industry, domain, and description. `status` defaults to `ACTIVE` (the other value is
`DRAFT`). `page` defaults to `1`, `pageSize` defaults to `20` (max `100` — requesting
more returns 400).

```json
{
  "data": [
    {
      "id": "cm...",
      "cluster": "Information Technology & Digital",
      "industry": "Data Science & Artificial Intelligence",
      "domain": "Data Science",
      "jobRole": "Data Scientist",
      "aiResilienceGrade": "MEDIUM",
      "aiResilienceComment": "...",
      "oneLineDescription": "...",
      "topCompanies": ["Google", "Amazon", "..."],
      "salaryIndiaRangeText": "₹6–25 LPA",
      "salaryIndiaMinLPA": 6,
      "salaryIndiaMaxLPA": 25,
      "salaryGlobalRangeText": "$70k–$160k",
      "salaryGlobalMinUSD": 70000,
      "salaryGlobalMaxUSD": 160000,
      "qualification10th12th": "12th (PCM/Commerce with Maths)",
      "qualificationGraduation": "Graduation in CS/IT/Maths/Statistics.",
      "qualificationPG": "...",
      "entranceExamsUGDescription": "...",
      "entranceExams": ["BITSAT", "CUET UG", "JEE Main"],
      "entranceExamsPG": ["GATE", "CAT/XAT"],
      "certificationsStudent": ["..."],
      "certificationsUG": ["..."],
      "topCourses": ["BSc CS", "BTech CSE", "..."],
      "status": "ACTIVE",
      "createdBy": "seed:career-library-import",
      "updatedBy": null,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1317, "totalPages": 66 }
}
```
**Important**: `salaryIndiaMinLPA`/`salaryIndiaMaxLPA`/`salaryGlobalMinUSD`/
`salaryGlobalMaxUSD` can be **`null`** — the source data has non-numeric ranges (e.g.
"0–Limitless", "$0–Millions"). Always fall back to displaying the corresponding
`*RangeText` field when the parsed numbers are null; never assume they're populated.

### 9.2 Filter options (for building dropdown UI)

`GET /filters`
```json
{
  "clusters": ["Arts, Design & Creative", "Aviation", ...],
  "industries": ["Actuarial Science", "Allied Medicine", ...],
  "domains": ["...", "..."],
  "aiResilienceGrades": ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]
}
```
`clusters`/`industries`/`domains` are derived from `ACTIVE` entries only — build your
dropdowns from this endpoint rather than hardcoding the list (it can grow as more
careers are added).

### 9.3 Single entry with related data

`GET /{id}` — 404 if not found.

Returns everything from the list shape above, plus three related-data arrays
(matched by value — industry/cluster/exam-name — not a strict foreign key, so an
empty array is possible and valid, not a bug):

```json
{
  "...": "all fields from 8.1",
  "relatedInstitutions": [{ "id": "cm...", "name": "IIT Madras", "city": "Chennai", "industry": "Data Science & Artificial Intelligence", "...": "..." }],
  "relatedCourses": [{ "id": "cm...", "courseName": "BCA", "level": "UG", "careerCluster": "Information Technology & Digital", "...": "..." }],
  "relatedEntranceExams": [{ "id": "cm...", "examName": "JEE Main", "fullForm": "...", "...": "..." }]
}
```

There's no write API for Career Library (no create/edit/delete, no counsellor
"request to add a career" flow) — display only.

---

## 10. Sessions

Base path: `/api/v1/sessions`. Implements the blind, first-available-slot booking flow
from `docs/session-scheduling-use-cases.md`. **No auth/role checks yet** — like every
other module, any caller can act as any role via the `role`/`initiatedBy` body fields.

### 10.1 Slot import (Admin, once per project)

`POST /slots/import` — body `{ projectId, slots: [{ counsellorId, date, startTime, endTime }] }`
(`date`: `"YYYY-MM-DD"`, times: `"HH:mm"`). This is the institute's counsellor-
availability Excel sheet, parsed client-side or by whoever's driving this call — the
API just takes the parsed rows. **One-time only**: `409` if the project already has
slots imported. `400` if any `counsellorId` isn't assigned to the project via
`ProjectCounsellor` yet.
```json
{ "imported": 42 }
```

`GET /slots?projectId=&counsellorId=&status=` — oversight list (`status`: `OPEN` |
`BOOKED`).

### 10.2 Session 1 booking options (blind)

`GET /students/{studentId}/booking-options?sessionNumber=SESSION_1` — deduped list of
open `{ slotDate, startTime, endTime }` combos across the student's project. **No
counsellor is shown or returned** — that's the point of blind booking.
```json
[{ "slotDate": "2026-08-20T00:00:00.000Z", "startTime": "16:00", "endTime": "16:45" }]
```

### 10.3 Session 2 preview (locked to Session 1's counsellor)

Same endpoint, `sessionNumber=SESSION_2`, plus `session1Date` and `session1StartTime` —
the Session 1 slot the student is currently previewing. The backend resolves which
counsellor *would* be assigned (first-available, upload order) and returns only that
counsellor's other open slots, at least 2 calendar days after `session1Date`. This is a
stateless preview — nothing is booked or held. `409` if that Session 1 date/time isn't
open anymore (someone else took it).

### 10.4 Book both sessions

`POST /students/{studentId}/book` — body:
```json
{
  "session1": { "date": "2026-08-20", "startTime": "16:00" },
  "session2": { "date": "2026-08-23", "startTime": "10:00" }
}
```
Books Session 1 & 2 **atomically, in one call** — matches the "student picks S1, then
S2, then confirms" UI flow, but only one network call happens at the final confirm
step; §10.2/§10.3 are what drive the picker UI in between. `201` with
`{ session1, session2, counsellor }` (each session includes nested `student` and
`counsellor`). **400** if the student hasn't reached `ASSESSMENT_COMPLETED` yet — show
the "booking unlocks after your assessment is completed" message from
`error.message` directly, don't build your own copy for this case. **409** if the
student already has sessions booked, or if either slot got claimed by someone else
between the preview and this call (rare, but handle it — just re-fetch booking options
and let them pick again).

Fires `SESSION_SCHEDULED_CONFIRMATION_STUDENT`/`_PARENT`/`_COUNSELLOR` emails
automatically (the counsellor variant isn't from the source WhatsApp/PDF copy — added
so the assigned counsellor gets notified too); no frontend action needed for that part.

### 10.5 Dashboard listings

`GET /students/{studentId}` — the student's session cards (both sessions, whatever
their status). `GET /counsellors/{counsellorId}?status=` — same, for a counsellor's
dashboard.

**"My Students"**: `GET /counsellors/{counsellorId}/my-students` — the counsellor's full student roster,
across every project they're assigned to (`ProjectCounsellor`) — **not** filtered down
to only students they already have a session with. This is the "who's approaching
booking-readiness" view, so it deliberately includes students who haven't booked yet.
Query: `projectId?` (scope to one project — `400` if the counsellor isn't assigned to
it), `workflowStatus?`.
```json
[
  {
    "id": "cm...",
    "studentCode": "CB1",
    "firstName": "Aditi",
    "lastName": "Rao",
    "email": "aditi.rao@example.com",
    "mobile": "+919876500001",
    "class": "Grade 9",
    "division": "A",
    "fatherName": "Ramesh Rao",
    "motherName": "Sunita Rao",
    "parentMobile": "+919876500003",
    "parentEmail": "parent-aditi@example.com",
    "workflowStatus": "ASSESSMENT_COMPLETED",
    "formsSubmitted": 3,
    "totalForms": 4,
    "assessmentSubmitted": true,
    "sessions": []
  }
]
```
`formsSubmitted`/`totalForms` count the 4 form types that go through the generic form
engine (`PRE_COUNSELLING_STUDENT`, `PRE_COUNSELLING_PARENT`, `FEEDBACK_STUDENT`,
`FEEDBACK_PARENT`) — `STUDENT_PROFILE` isn't one of them (it's Student columns,
tracked via `workflowStatus` reaching `PROFILE_COMPLETED` instead, §6.1). `sessions` is
scoped to *this* counsellor specifically — it'll be `[]` for a student who hasn't been
blind-assigned to them yet, even if that student has sessions with a different
counsellor.

### 10.6 Meeting link

`PATCH /sessions/{id}/meeting-link` — body `{ "meetingLink": "https://..." }`. Manual
paste (Admin/Counsellor) — there's no Calendly/Google Meet integration, so nothing
generates this automatically. Until it's set, `meetingLink` is `null` and `POST
/{id}/join` will report it as such.

### 10.7 Join Now

`POST /sessions/{id}/join` — body `{ "role": "STUDENT" }` or `{ "role": "COUNSELLOR" }`.
Only call this from an actual "Join Now" button click — it's the event that gets
recorded (`studentJoinedAt`/`counsellorJoinedAt`), not just a link fetch. Window: from
10 minutes before `startTime` through `endTime` — **400 outside that window**, so gate
the button client-side using the session's own `scheduledDate`/`startTime`/`endTime`
rather than relying on the error alone.
```json
{ "session": { "...": "..." }, "meetingLink": "https://meet.example.com/abc" }
```

### 10.8 Session notes

`PATCH /sessions/{id}/notes` — body `{ "notes": "..." }`. Counsellor-only in intent
(not enforced yet); independent of booking/join — can be called before, during, or
after the session.

### 10.9 Complete a session

`POST /sessions/{id}/complete` — the "Session Completed?" confirmation button
mentioned in the flow. No body. Sets `status: COMPLETED` and advances the student's
`workflowStatus` (`SESSION_1_COMPLETED` / `SESSION_2_COMPLETED` — see §6.1).

### 10.10 Reschedule / cancel

`POST /sessions/{id}/reschedule` — body `{ "date", "startTime", "initiatedBy" }`
(`initiatedBy`: `STUDENT` | `COUNSELLOR` | `ADMIN`). Same counsellor stays locked;
**400** if `initiatedBy: "STUDENT"` and it's within 24 hours of the current
`startTime` — surface that as "reschedule requests need 24 hours' notice", don't let
the student attempt it past that point client-side either (skipped when the session
being rescheduled is already `CANCELLED`, since there's no upcoming session to
protect). Re-validates the 2-day gap against the student's other session.

`POST /sessions/{id}/cancel` — body `{ "reason", "notes"?, "initiatedBy" }` (`reason`:
`STUDENT_UNAVAILABLE` | `COUNSELLOR_UNAVAILABLE` | `INSTITUTION_REQUEST` | `OTHER`).
Releases the slot back to `OPEN`.

**Re-booking after a cancellation — don't route this back through §10.4's book
endpoint, it will 409.** `@@unique([studentId, sessionNumber])` means the cancelled
`Session` row is still occupying that slot, so a fresh `POST
/students/{studentId}/book` (or a plain `POST /sessions`) rejects with 409 for as long
as that row exists. There are two real paths back in, and they're not the same
endpoint you'd use for the original booking:
- **Same counsellor still fine, just need a new time** — call `POST
  /sessions/{id}/reschedule` on the *cancelled* session's id. It reactivates that row
  (`status` back to `SCHEDULED`, `cancellationReason`/`cancellationNotes` cleared),
  still locked to the same counsellor.
- **Counsellor itself is the problem** (e.g. `reason: COUNSELLOR_UNAVAILABLE`) — an
  admin calls `POST /sessions` (the manual-creation endpoint — see `docs/api-list.md`,
  not covered elsewhere in this guide) with a *different* `counsellorId` for that same
  `studentId` + `sessionNumber`. It detects the existing
  `CANCELLED` row and reactivates it in place with the new counsellor/date/time,
  rather than trying (and failing) to insert a second row.

Both reschedule and cancel send the matching
`SESSION_RESCHEDULED_*`/`SESSION_CANCELLED_*` emails automatically.

### 10.11 Day-of reminder (manual trigger)

`POST /sessions/{id}/send-day-reminder` — body `{ "portalLink"? }`. Sends to student,
parent, **and the assigned counsellor**. There's no scheduler/cron built yet (same gap
as the rest of the Email module, §12), so nothing fires this on the morning of the
session automatically — something (an admin action, a manual ops script) has to call
it.

---

## 11. Feedback (Counsellor Satisfaction Score)

Base path: `/api/v1/feedback`. Read-only scoring derived from the two post-counselling
feedback forms (which are submitted through the Forms API, §7, as `FEEDBACK_STUDENT` /
`FEEDBACK_PARENT`). Student feedback counts 80%, parent 20%.

### 11.1 One student's score

```
GET /feedback/students/{studentId}/score
```
Needs **both** feedback forms *submitted*. If a form is missing, you get
`{ complete: false, missingForms: [...] }` (still 200 — not an error). Otherwise:

```json
{
  "studentId": "cm...",
  "complete": true,
  "score": {
    "student": { "sections": [{ "code": "S-SE", "label": "Session Experience", "average": 4.0, "percent": 80, "questionCount": 4 }], "scorePercent": 80 },
    "parent":  { "sections": ["..."], "scorePercent": 80 },
    "finalPercent": 80,
    "band": "Strong Performer",
    "incentive": 750,
    "interpretation": "Strong, reliable performance"
  }
}
```

### 11.2 A counsellor's overall score

```
GET /feedback/counsellors/{counsellorId}/score
```
Averages the Final Score % of the counsellor's students who have **both** forms
complete (students are linked via their sessions). Incomplete pairs are counted in
`excludedStudents` and left out of the average.

```json
{
  "counsellorId": "cm...",
  "totalStudents": 12, "includedStudents": 10, "excludedStudents": 2,
  "sessions": [{ "studentId": "cm...", "finalPercent": 82.4, "band": "Strong Performer" }],
  "overall": { "overallPercent": 84.1, "band": "Strong Performer", "incentive": 750, "interpretation": "Strong, reliable performance" }
}
```
`overall` is `null` if no student has a complete pair yet.

**Performance bands** (applied to Final/Overall %): 90–100 Top Performer (₹1,000) ·
80–89 Strong Performer (₹750) · 70–79 Needs Improvement (₹500) · <70 Critical (₹0).

## 12. Email

Base path: `/api/v1/email`. Sends transactional email through a configurable
provider — set via the `EMAIL_PROVIDER` env var (`console` in local dev, which just
logs the email instead of sending; `mailgun` to send for real through Mailgun's API).
This is a backend-triggered service, not something the frontend calls directly in
normal flows — but it's useful for admin tooling or manual trigger UIs, and the shape
below is what such a UI would call.

### 12.1 List available templates

`GET /templates` — returns all 40 `templateKey` values (9 lifecycle templates + 31
reminder/session-status templates). Full list with required `data` fields per key:
[`src/modules/email/README.md`](../src/modules/email/README.md).
```json
{ "templateKeys": ["WELCOME_STUDENT", "WELCOME_PARENT", "..."] }
```

### 12.2 Send a template email

`POST /send`
```json
{
  "to": "student@example.com",
  "templateKey": "LOGIN_CREDENTIALS_STUDENT",
  "data": {
    "studentName": "Aarav",
    "loginId": "aarav.k",
    "defaultPassword": "Xk9#mPq2",
    "loginLink": "https://www.designdestiny.org/kREATE"
  }
}
```
`data` fields are template-specific — a 400 with `error.details.fieldErrors` lists
what's missing or wrong if it doesn't match. On success, `202` with
`{ providerMessageId, subject, provider }`.

9 templates correspond 1:1 to the kREATE lifecycle communications (welcome, login
credentials, pre-counselling nudge, session details, feedback request, final report)
— see `docs/11.Class 910_Communication EMail Templates.pdf` for the original copy each
implements. The other 31 are reminder/session-status templates (activation reminder,
form-pending nudges, assessment reminder, session scheduling/day-of/reschedule/
cancel/no-show, feedback reminders) — the email equivalents of the WhatsApp copy in
`docs/Class 910_Workflow Prompts for Watsapp.xlsx`, plus 3 counsellor variants (session
scheduling confirmation, Session 1/2 day reminder) added for the Sessions module that
aren't from that sheet. WhatsApp sending itself isn't implemented, only the email
versions.

---

## 13. Not built yet — don't integrate against these

Do **not** start frontend work assuming these exist. Ask the backend team for status
before building UI that depends on any of them:

- **Route-level auth enforcement** — login/refresh/logout work (§2), but no other
  endpoint checks the access token or a role yet. Every API call above still works
  with no credentials at all, in dev. There's also no password-reset/forgot-password
  or change-password flow.
- **Counsellor CRUD** — no way to create/list/update counsellors via API yet, even
  though the `Counsellor` table exists. Sessions (§10) can reference an existing
  `counsellorId`, but there's nowhere to create one via the API — seed it directly.
- **Project CRUD** — same story; `Project` rows currently only exist via direct DB
  seeding, no API.
- **Career Library writes** — no create/edit/delete, no counsellor ratification-
  request flow.
- **Assessment scoring — nearly complete.** Submitting an attempt computes the full
  `AssessmentResult` — trait scores/grades, DCS, DPS, Stream Fit, Graduation Pathways,
  Career Fit (top-6 domains + representative careers), and RVS/ACI/ORI/DC reliability
  (see §8.4). The **only** piece still not produced is Time-Consistency + composite ARI
  (needs per-question `timeTakenMs`); don't build the composite-ARI tile against this yet.
- **Reports** (Career kREATE / IKIGAI PDF, parent/institution summaries) — no
  generation logic yet. **Counsellor Chart is built** — `GET`/`PUT
  /api/v1/counsellor-chart/students/{id}` assemble the chart and save notes/SCRI/ratings,
  and `POST`/`DELETE …/mirror-pair-amendments` let the counsellor amend a flagged answer,
  which re-runs the full scoring engine (see `docs/api-list.md`). `workflowStatus` stages
  past `SESSION_2_COMPLETED` still only move via the `PATCH /students/{id}/workflow-status`
  admin override (§6.1).
- **Role-based access control** — no concept of "this user can only see their own
  data" enforced anywhere, in Sessions (§10) or elsewhere yet.
- **Real meeting-link generation** — Sessions' `meetingLink` (§10.6) is a manually
  pasted plain string; no Calendly/Google Meet integration.
- **Automatic email/reminder triggers** — the Email module (§12) can send any
  template, and a few Sessions actions (§10.4, §10.10) trigger one automatically, but
  there's no scheduler/cron — same-day reminders (§10.11), "+2 days if incomplete"
  nudges, and no-show emails all need something external calling the API at the right
  moment; nothing fires them on its own yet.

If you need to demo or test flows that depend on these, ask the backend team what's
next in the build queue rather than guessing at a shape.

---

## Questions / mismatches

If anything in this doc doesn't match what you're actually seeing from the API,
**trust the API and Swagger (`/docs`) over this doc** — flag the mismatch to the
backend team so this gets corrected. This file is maintained alongside the code but
can lag by a commit or two.
