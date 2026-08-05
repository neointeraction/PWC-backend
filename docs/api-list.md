# API List

Live source of truth for every HTTP endpoint in this service. **Update this file in
the same change as any route added, removed, or modified** — it's the quick-reference
companion to the interactive Swagger UI.

- Interactive docs (Swagger UI): `GET /docs`
- Raw OpenAPI spec: `GET /docs/openapi.json`
- Base path for all API routes below: `/api/v1` (except `/health`, which is unprefixed)
- Auth: none of these endpoints are protected yet — role-based authorization
  middleware is still pending (see `CLAUDE.md`)

Last updated: 2026-08-06 (after adding the Career Library retrieval/search endpoints).

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check. Returns `{ status: "ok", timestamp }`. |

## Auth

Stub module — no endpoints implemented yet (register/login/refresh/logout pending).

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
| GET | `/api/v1/students` | List students. Query: `projectId?, divisionId?`. |
| GET | `/api/v1/students/{id}` | Get one student (with user, project, division). |
| PATCH | `/api/v1/students/{id}` | Update a student (partial body; validates `divisionId` still belongs to the student's project institute if changed). |
| DELETE | `/api/v1/students/{id}` | Delete a student (deletes the linked `User` too, which cascades). |

## Forms

Serves the seeded pre-counselling and feedback form templates (question content —
see `docs/db-design.md` for the full schema notes).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/forms/{formType}` | Get a form template with its questions, ordered. `formType`: `STUDENT_PROFILE` \| `PRE_COUNSELLING_STUDENT` \| `PRE_COUNSELLING_PARENT` \| `FEEDBACK_STUDENT` \| `FEEDBACK_PARENT`. Query: `cohort` (required, e.g. `CLASS_9_10`), `version?` (defaults to the active version). 404 if no template exists for that formType+cohort. |
| GET | `/api/v1/forms/{formType}/students/{studentId}` | Get a student's (or parent's) submission for a form, with answers. Query: `cohort` (required), `version?`. 404 if no submission exists yet. |
| PUT | `/api/v1/forms/{formType}/students/{studentId}` | Save/update in-progress answers ("Save as Draft"). Body: `cohort, version?, answers: [{ fieldKey, answer }]`. Upserts a `FormSubmission` + `FormAnswer` rows; idempotent, callable repeatedly. 400 on an unknown `fieldKey`. 409 if the form was already submitted (locked). |
| POST | `/api/v1/forms/{formType}/students/{studentId}/submit` | Finalize a submission. Same body shape as the draft `PUT` (answers here are merged with any existing draft). Validates every `isRequired` question has a non-empty answer — 400 with `{ missingFieldKeys }` if not — then sets `submittedAt` and locks the submission. 409 if already submitted. |

`submittedByRole` (`STUDENT` vs `PARENT`) is derived automatically from `formType` —
not a request parameter — since each form type is filled by exactly one role.

`STUDENT_PROFILE` currently returns an empty question list on `GET .../{formType}` —
that content was modeled as first-class `Student` columns (father/mother details,
primary contact) instead of generic form questions; see `docs/db-design.md`.

## Assessment

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/assessment/questions` | List assessment questions for a cohort, ordered. Query: `cohort` (required), `section?` (`RIASEC` \| `BIG_FIVE` \| `APTITUDE` \| `COGNITIVE`). **`correctOption` is never included in the response** — it's the aptitude answer key and must not be exposed to whoever is taking the assessment. |
| POST | `/api/v1/assessment/attempts` | Start a new attempt, or resume the student's existing `IN_PROGRESS` one for the given cohort. Body: `studentId, cohort`. 200 either way (not 201 — may resume rather than create). 409 if the student already has a `SUBMITTED` attempt for this cohort. |
| GET | `/api/v1/assessment/attempts/{attemptId}` | Get an attempt with its answers (questions included, `correctOption` excluded). |
| PUT | `/api/v1/assessment/attempts/{attemptId}/answers` | Save/update answers ("Save Progress"). Body: `answers: [{ fieldKey, selectedOption }]`. Upserts `AssessmentAnswer` rows; idempotent. 400 on an unknown `fieldKey`. 409 if the attempt is already submitted (locked). |
| POST | `/api/v1/assessment/attempts/{attemptId}/submit` | Finalize an attempt. Validates every question in the cohort has an answer — 400 with `{ missingFieldKeys }` if not — then sets `status: SUBMITTED` + `submittedAt` and locks it. 409 if already submitted. |

No `AssessmentResult` (trait scores / recommended streams) is computed on submit —
PWC's scoring/weighting logic isn't supplied yet. Submission only validates
completeness and locks the attempt; see `docs/db-design.md`.

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

## Docs

| Method | Path | Description |
|---|---|---|
| GET | `/docs` | Swagger UI. |
| GET | `/docs/openapi.json` | Raw OpenAPI 3.0 spec. |

## Not yet built

For context on what's deliberately missing — see `CLAUDE.md` → "What's not built yet"
and `docs/db-design.md` → "Deliberate scope gaps". Notably: auth endpoints, counsellor
CRUD, project CRUD, session booking (design finalized — see
`docs/session-scheduling-use-cases.md` — not yet implemented), career library
create/edit/delete + counsellor ratification-request flow, assessment
result/scoring computation, report generation, and any role-based access control.
