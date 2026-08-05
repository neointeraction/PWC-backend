# API List

Live source of truth for every HTTP endpoint in this service. **Update this file in
the same change as any route added, removed, or modified** — it's the quick-reference
companion to the interactive Swagger UI.

- Interactive docs (Swagger UI): `GET /docs`
- Raw OpenAPI spec: `GET /docs/openapi.json`
- Base path for all API routes below: `/api/v1` (except `/health`, which is unprefixed)
- Auth: none of these endpoints are protected yet — role-based authorization
  middleware is still pending (see `CLAUDE.md`)

Last updated: 2026-08-04 (after adding the Forms and Assessment retrieval endpoints).

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

`STUDENT_PROFILE` currently returns an empty question list — that content was modeled
as first-class `Student` columns (father/mother details, primary contact) instead of
generic form questions; see `docs/db-design.md`.

No submission endpoint yet (`POST` to save a student's/parent's answers) — only
retrieval is built so far.

## Assessment

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/assessment/questions` | List assessment questions for a cohort, ordered. Query: `cohort` (required), `section?` (`RIASEC` \| `BIG_FIVE` \| `APTITUDE` \| `COGNITIVE`). **`correctOption` is never included in the response** — it's the aptitude answer key and must not be exposed to whoever is taking the assessment. |

No attempt/submission endpoints yet (`POST` to start an attempt, save answers, or
compute a result) — only question retrieval is built so far.

## Docs

| Method | Path | Description |
|---|---|---|
| GET | `/docs` | Swagger UI. |
| GET | `/docs/openapi.json` | Raw OpenAPI 3.0 spec. |

## Not yet built

For context on what's deliberately missing — see `CLAUDE.md` → "What's not built yet"
and `docs/db-design.md` → "Deliberate scope gaps". Notably: auth endpoints, counsellor
CRUD, project CRUD, session booking, career library CRUD/ratification, form/assessment
*submission* endpoints, report generation, and any role-based access control.
