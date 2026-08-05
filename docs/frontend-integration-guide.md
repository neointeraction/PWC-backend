# Frontend Integration Guide

For the frontend team integrating against this API. Covers what exists today, exact
request/response shapes, and — just as important — what doesn't exist yet so you
don't build against endpoints that aren't there. This is a companion to
[`docs/api-list.md`](./api-list.md) (terse endpoint reference, kept up to date on
every change) and the interactive Swagger UI; start here for the "how do I actually
call this" details, use those for the day-to-day quick lookup.

**Status: pre-alpha backend.** No authentication is wired up yet, most write flows
(session booking, career library management, reports) don't exist yet, and the shapes
below can still change as we build out the remaining modules. Treat this as a moving
target — check `docs/api-list.md`'s "Last updated" line and re-read before starting
new integration work.

---

## 1. Base setup

- **Local dev base URL**: `http://localhost:4000` (port from `PORT` env var, default
  `4000`)
- **All API routes are prefixed `/api/v1`**, except `GET /health` which is
  unprefixed.
- **Content type**: `application/json` for all request bodies and responses.
- **Auth**: none. No login endpoint, no token, no cookies — every route is currently
  open. Do **not** build login/token-refresh UI yet; there's nothing on the backend to
  call. This is the single biggest gap — flagged repeatedly below.
- **CORS**: allowed origin is controlled by the backend's `CORS_ORIGIN` env var
  (defaults to `http://localhost:3000` in dev). Tell the backend team your dev server
  port if it's different.
- **Interactive docs**: `GET /docs` (Swagger UI), raw spec at `GET /docs/openapi.json`
  — useful for exploring request/response schemas interactively, though the
  descriptions there are intentionally terse; this doc has the fuller picture.

## 2. Error response contract

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

## 3. Conventions to know before you start

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

## 4. Institutes

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

**Note**: there's no `Project` endpoint yet (see §9), but `Student.projectId`
references one — for now, get a project ID from whoever seeds/creates it directly in
the DB, or wait for the Project module.

---

## 5. Students

Base path: `/api/v1/students`

| Method | Path | Body / Query |
|---|---|---|
| POST | `/` | see below |
| GET | `/` | query: `projectId?`, `divisionId?` |
| GET | `/{id}` | — |
| PATCH | `/{id}` | partial body, same fields as create minus `email`/`studentCode`/`projectId` (immutable) |
| DELETE | `/{id}` | deletes the linked `User` too (cascades) |

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
password"/resend flow yet (that needs the Auth module, see §9). If you lose it,
someone will need to regenerate it directly against the DB for now.

`workflowStatus` is one of: `DRAFT`, `PROFILE_COMPLETED`,
`PRE_COUNSELLING_FORMS_SUBMITTED`, `ASSESSMENT_PENDING`, `ASSESSMENT_COMPLETED`,
`SESSION_SCHEDULED`, `SESSION_1_COMPLETED`, `COUNSELLOR_FEEDBACK_REPORT`,
`SESSION_2_COMPLETED`, `COUNSELLOR_FEEDBACK`, `STUDENT_PARENT_FEEDBACK`, `CLOSED`.
**Nothing currently transitions this field automatically** — no endpoint advances it
yet (also part of the not-built-yet Session/Report modules). Don't build UI that
expects it to change on its own.

GET responses use the same nested shape (`user`, `project`, `division`) minus
`tempPassword`.

---

## 6. Forms

Base path: `/api/v1/forms`. Covers the pre-counselling and feedback questionnaires —
**not** a generic CMS; content is fixed per `formType` + `cohort`.

`formType` values: `STUDENT_PROFILE`, `PRE_COUNSELLING_STUDENT`,
`PRE_COUNSELLING_PARENT`, `FEEDBACK_STUDENT`, `FEEDBACK_PARENT`.
Currently seeded cohort: `"CLASS_9_10"` (this is a free-text string, not an enum —
ask the backend team before assuming other cohort values exist).

`STUDENT_PROFILE` has **no questions** — that content lives on the `Student` record
directly (father/mother details, contact info — see §5), not as a form. Fetching it
returns a template with `questions: []`; don't render an empty form, just skip it.

### 6.1 Get a form template (the questions to render)

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

### 6.2 Save a draft / submit answers

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

---

## 7. Assessment

Base path: `/api/v1/assessment`. The psychometric assessment (RIASEC, Big Five,
Aptitude, Cognitive sections), cohort `"CLASS_9_10"` currently seeded, 73 questions
total.

### 7.1 Get the question bank

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
scoring yet (see §9).

### 7.2 Start / resume an attempt

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

### 7.3 Save answers / submit

```
PUT /attempts/{attemptId}/answers
```
```json
{ "answers": [{ "fieldKey": "riasec_realistic_r1", "selectedOption": "3" }] }
```
`selectedOption` is a Likert value string (`"1"`–`"5"`) or an MCQ option letter
(`"A"`–`"E"`). Idempotent, call repeatedly as the student progresses (implements
"Save Progress"). 409 if the attempt is already `SUBMITTED`.

```
POST /attempts/{attemptId}/submit
```
No body. Validates **every** question in the cohort has an answer (unlike Forms,
there's no per-question "optional" flag — all 73 are required) — 400 with
`{ missingFieldKeys: [...] }` if incomplete, otherwise sets `status: "SUBMITTED"` and
locks it.

```
GET /attempts/{attemptId}
```
Fetch current state (answers include the nested `question`, `correctOption` still
excluded). Use this to resume/render a saved attempt.

**No score is computed anywhere.** `AssessmentResult` (trait scores, recommended
career streams) doesn't exist yet — PWC hasn't supplied the scoring logic. Don't build
a "results" screen against this API yet.

---

## 8. Career Library

Base path: `/api/v1/career-library`. Read-only browse/search over ~1,300 career
entries plus related UG/PG institution, course, and entrance-exam reference data.

### 8.1 Search / list

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

### 8.2 Filter options (for building dropdown UI)

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

### 8.3 Single entry with related data

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

## 9. Not built yet — don't integrate against these

Do **not** start frontend work assuming these exist. Ask the backend team for status
before building UI that depends on any of them:

- **Authentication** — no login, logout, token refresh, or password-reset/forgot
  endpoints. Nothing is protected by a role check yet. Every API call above works
  with no credentials at all, in dev.
- **Session booking** (video counselling sessions) — schema/design finalized (see
  `docs/session-scheduling-use-cases.md`) but no endpoints built. This covers slot
  upload, blind booking, reschedule, "Join Now", meeting links.
- **Counsellor CRUD** — no way to create/list/update counsellors via API yet, even
  though the `Counsellor` table exists.
- **Project CRUD** — same story; `Project` rows currently only exist via direct DB
  seeding, no API.
- **Career Library writes** — no create/edit/delete, no counsellor ratification-
  request flow.
- **Assessment scoring** — no `AssessmentResult` computation; submitting an attempt
  only locks it, doesn't produce trait scores or recommendations.
- **Reports** (Career IKIGAI Report PDF, parent/institution summaries) — no endpoints,
  no generation logic.
- **Role-based access control** — no concept of "this user can only see their own
  data" enforced anywhere yet.
- **Notifications/emails** — nothing is actually sent (form-submission confirmations,
  session reminders, etc. are all still just documented intentions).

If you need to demo or test flows that depend on these, ask the backend team what's
next in the build queue rather than guessing at a shape — several of the above (e.g.
sessions) have a fully resolved design doc but zero implemented code, so guessing
would likely be wrong.

---

## Questions / mismatches

If anything in this doc doesn't match what you're actually seeing from the API,
**trust the API and Swagger (`/docs`) over this doc** — flag the mismatch to the
backend team so this gets corrected. This file is maintained alongside the code but
can lag by a commit or two.
