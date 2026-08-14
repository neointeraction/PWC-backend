---
name: add-module
description: Scaffold a new feature module (routes, controller, service, Zod schema) following this project's modular-monolith conventions. Use when adding a new domain area to the counselling platform API (e.g. "add a forms module", "create the assessment module").
---

# Add a new feature module

Code is organized by feature under `src/modules/<name>/`, per
[CLAUDE.md](../../CLAUDE.md). Good reference modules to copy from:
`counsellors/` and `projects/` (clean CRUD), `reports/` (read assembly).

## 1. Clarify scope first

Do not assume field names, validation rules, or business logic. Confirm:
- What data the module owns (fields, relations to existing Prisma models).
- **Which roles can hit which endpoint** (drives step 4 — this is not
  optional anymore; every route is guarded).
- Whether new Prisma models/enums are needed — if so, get exact field names
  and run the `add-migration` skill.

## 2. Scaffold files

Create `src/modules/<name>/`:

- `<name>.schema.ts` — Zod schemas for body/params/query, with `z.infer<>`
  types exported. Params use `z.string().cuid()`.
- `<name>.service.ts` — business logic + Prisma. Import `prisma` from
  `../../config/prisma.js`. Throw `AppError` subclasses
  (`BadRequestError`/`NotFoundError`/`ConflictError`/`ForbiddenError`) for
  expected failures. Wrap create/update in `try/catch` +
  `handlePrismaError(err)` (`common/utils/prismaErrors.ts`) so unique-constraint
  violations become 409s.
- `<name>.controller.ts` — thin: parse `req`, call service, send response.
  Read the caller via `req.user` (`{ sub, role, email }`) when needed.
- `<name>.routes.ts` — an Express `Router()`. Each route:
  `router.<verb>(path, ...<guard>, validate({...}), asyncHandler(controller.x))`.

## 3. Conventions that recur

- **Reads = staff, writes = admin** is the default split for admin-managed
  resources (see institutes/students/counsellors/projects).
- **Delete with dependents** — if a hard delete would orphan/cascade important
  rows (sessions, students), pre-check and throw `ConflictError` with a count
  in `details`, steering the user to a soft-close (`status`/`isActive`) instead.
  See `counsellors.service.deleteCounsellor` / `projects.service.deleteProject`.
- Route ordering: literal segments (`/filters`, `/requests`, `/students/:id/status`)
  must be registered **before** a catch-all `/:id`.

## 4. Apply auth guards (required)

Guards live in `src/common/middlewares/auth.ts` — spread the convenience
stacks into the route:

| Stack | Who | Use for |
|---|---|---|
| `requireAuth` | any logged-in user | reference reads students also see (career library) |
| `requireStudentOrStaff` | student + staff | student self-service (own forms/assessment/sessions) |
| `requireStaff` | counsellor + admin + super admin | operational reads/actions |
| `requireAdmin` | admin + super admin | create/edit/delete, imports |

For **student-facing** routes, also add per-record **ownership** so a student
only touches their own data (`src/common/middlewares/ownership.ts`):
`ownStudentParam` (`:studentId`), `ownStudentBody` (`body.studentId`),
`ownAttemptParam` (`:attemptId`), `ownSessionParam` (`:id`), `ownStudentForm`
(formType-aware). Place the ownership guard after `validate(...)`.

Public exceptions (no guard): health, `auth/*`, docs, and the parent forms.

## 5. Wire it up

Mount the router in `src/app.ts` under `/api/v1/<name>` (add the import too).

## 6. Register in OpenAPI/Swagger (required — it's hand-maintained)

`src/config/openapi.ts` does **not** auto-generate from routes. Add a
`registry.registerPath({...})` for every new route (import the schemas at the
top). Authenticated routes need nothing extra (bearer is the document default);
mark public ones with `...PUBLIC`. Missing this = the route silently disappears
from `/docs`.

## 7. Tests

Add `test/<name>.test.ts` with `supertest` against `createApp()`. Auth is
enforced, so use the helper `import { authRequest, bearer } from "./helpers/http.js"`:
- `authRequest(app)` — requests carry an ADMIN token (passes every guard); a
  one-line swap for `request(app)`.
- `authRequest(app, "STUDENT", { userId })` / `bearer("COUNSELLOR")` — for
  role- and ownership-specific tests (401 no token, 403 wrong role/other's record).

Use unique phone/email values per test file (suites run in parallel against one
test DB). Clean up in `afterAll`; delete rows that `RESTRICT` a cascade first
(e.g. sessions before their counsellor).

## 8. Docs

Update `docs/api-list.md` (route table) in the same change, plus
`docs/frontend-integration-guide.md` if request/response shapes matter to the
frontend, and `docs/db-design.md` for schema changes. Refresh the "what's
built / not built" note in `CLAUDE.md` when a roadmap item lands.

## Verify

`pnpm typecheck && pnpm test` before finishing.
