# Counselling Platform Backend

Node.js/Express/TypeScript API for a counselling platform connecting students,
counsellors, and admins. Prisma + PostgreSQL for persistence.

## Stack

- Runtime: Node.js 22, TypeScript (strict mode), ESM (`"type": "module"`)
- Framework: Express 4
- ORM: Prisma + PostgreSQL (local dev against a local Postgres instance — role `pwc`, databases `pwc_counselling` / `pwc_counselling_test`)
- Validation: Zod (request DTOs), shared across API docs (zod-to-openapi, added later)
- Auth: JWT access + refresh tokens, argon2 password hashing
- Testing: Vitest + supertest
- Package manager: pnpm

## Architecture: modular monolith

Code is organized by **feature module**, not by technical layer. Each module
under `src/modules/<name>/` owns its own routes, controller, service, and
Zod schemas. Shared, cross-cutting code lives in `src/common/` and
`src/config/`.

```
src/
  app.ts                  # Express app assembly (middleware + route mounting)
  server.ts               # process entrypoint (listen)
  config/
    env.ts                # Zod-validated environment variables — import env from here, never process.env directly
    prisma.ts             # Prisma client singleton
  common/
    errors/AppError.ts    # AppError + subclasses (BadRequestError, NotFoundError, ...)
    middlewares/
      errorHandler.ts     # centralized error handler + 404 handler
      validate.ts          # Zod-based request validation middleware
    utils/asyncHandler.ts # wraps async route handlers so rejections reach errorHandler
  modules/
    <feature>/
      <feature>.routes.ts
      <feature>.controller.ts
      <feature>.service.ts
      <feature>.schema.ts   # Zod schemas for this module's request/response DTOs
prisma/
  schema.prisma
  seed.ts
test/
  setup.ts               # test env vars
  <feature>.test.ts
```

## Conventions

- **Never read `process.env` directly** outside `src/config/env.ts`. Add new
  vars to the Zod schema there (and to `.env.example`) so missing/invalid
  config fails fast at startup.
- **Errors**: throw `AppError` subclasses (`BadRequestError`,
  `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`)
  from services/controllers. The central `errorHandler` middleware turns
  them into the right HTTP response. Don't `res.status(...).json(...)`
  error responses manually inside route handlers.
- **Async routes**: wrap handlers with `asyncHandler()` so rejected
  promises are forwarded to Express's error handling instead of crashing
  the process.
- **Validation**: define a Zod schema per module in `<feature>.schema.ts`,
  apply it with the `validate({ body, query, params })` middleware in the
  route file. Controllers can trust `req.body`/`req.query`/`req.params`
  are already validated and typed.
- **Roles**: `UserRole` enum in `prisma/schema.prisma` is the source of
  truth (`STUDENT`, `COUNSELLOR`, `ADMIN`, `SUPER_ADMIN`). Role-based
  authorization middleware will live in `src/common/middlewares/` once the
  auth module is built.
- **Status lifecycle**: `WorkflowStatus` (`prisma/schema.prisma`) and
  `Student.workflowStatus` model the 12-stage counselling case lifecycle
  (Draft → Profile Completed → ... → Closed). The shared transition helper
  is `advanceWorkflowStatus()` in `src/common/workflow/workflowStatus.ts` —
  forward-only and idempotent; call it from a module's service layer at the
  point a real action completes a stage (see `students.service.ts`,
  `forms.service.ts`, `assessment.service.ts`, `sessions.service.ts`,
  `counsellor-chart.service.ts`, `reports.service.ts` for existing call
  sites), don't hardcode status strings elsewhere. **All 12 stages now have a
  real trigger** — the tail is: chart save with real content →
  `COUNSELLOR_FEEDBACK_REPORT`, chart `/finalize` → `COUNSELLOR_FEEDBACK`,
  both feedback forms submitted → `STUDENT_PARENT_FEEDBACK`, and the
  student's own fetch of their assessment report → `CLOSED` (staff fetches
  don't close, and the close only fires from `STUDENT_PARENT_FEEDBACK` so an
  early fetch can't skip stages). The admin override at
  `PATCH /api/v1/students/:id/workflow-status` is a correction tool, not the
  normal path. Full trigger table in `docs/api-list.md`.
- **Imports**: this project uses ESM with `NodeNext` module resolution —
  relative imports must include the `.js` extension (even though the
  source file is `.ts`), e.g. `import { env } from "./config/env.js"`.
- **API docs**: update `docs/api-list.md` in the same change as any route
  added, removed, or modified — it's the quick-reference companion to the
  Swagger UI (`GET /docs`). Also update `docs/db-design.md` when the Prisma
  schema changes meaningfully, and `docs/frontend-integration-guide.md` when
  request/response shapes change (it has worked examples for the frontend
  team, not just a route list).

## Commands

```bash
pnpm install              # install dependencies
# Postgres runs locally via Homebrew (postgresql@14), not Docker — start with:
#   brew services start postgresql@14
pnpm prisma:generate      # generate Prisma client after schema changes
pnpm prisma:migrate       # create + apply a dev migration (dev DB only — see next line)
# Tests run against a SEPARATE database (pwc_counselling_test) that pnpm test does NOT
# migrate. After any new migration, apply it there too or the suite fails with
# "column ... does not exist":
#   DATABASE_URL="postgresql://pwc:pwc_dev_password@localhost:5432/pwc_counselling_test?schema=public" npx prisma migrate deploy
pnpm dev                  # run the API with hot reload
pnpm test                 # run the test suite (vitest)
pnpm typecheck             # type-check without emitting
```

## What's not built yet

This is intentionally staged — we're building module by module. Built so far: Auth
(login/refresh/logout — JWT access token + rotating httpOnly-cookie refresh token; no
self-register, every `User` including the one Super Admin is created by an admin/seed
with a temp password; see `src/modules/auth/`), Institutes, Students (including the
`workflowStatus` lifecycle — live/auto-advancing through `SESSION_2_COMPLETED`,
admin-override-only beyond that), Forms (pre-counselling/feedback questionnaires,
retrieval + submission), Assessment (question bank + attempt flow, no scoring yet),
Career Library (retrieval/search + cross-referenced UG/PG data), Sessions (blind
slot-based booking, join/no-show tracking, reschedule/cancel — design in
`docs/session-scheduling-use-cases.md`, fully resolved and implemented; see
`src/modules/sessions/`), Email (configurable provider — `console` for local dev,
Mailgun for real sends — with the 9 kREATE lifecycle templates plus 31
reminder/session-status templates; most sends are still a manual
`POST /api/v1/email/send` call, though booking/reschedule/cancel in Sessions trigger
the relevant template automatically), OpenAPI/Swagger docs. **Route-level auth is now
enforced** — `authenticate`/`requireRole` plus convenience stacks (`requireStaff`,
`requireAdmin`, `requireStudentOrStaff`) and per-record ownership guards
(`src/common/middlewares/ownership.ts`) are applied across every module; the parent
forms are deliberately public (parents have no login), gated by the project window
instead. Password change + forgot/reset flows are built (`src/modules/auth/`), and
Counsellor CRUD (`src/modules/counsellors/` — create/list/get/update/delete + project
assign/unassign) and Project CRUD (`src/modules/projects/` — create/list/get/update/
delete; `status:CLOSED` is the soft-close, delete is blocked when students exist) exist.
Career Library now has writes (`src/modules/career-library/` — admin create/update/delete
with a `DRAFT`→`ACTIVE` publish step) plus the counsellor ratification-request flow
(submit → admin approve/reject). Its normalized links (exams/courses/colleges) take the full
canonical field set on an inline "add new" and **blank-fill** rather than overwrite a row that
already exists; there is deliberately no endpoint yet for editing a canonical lookup row.
**Education Path** is modelled at the domain level (`DomainEducationEntry`, CRUD under
`/api/v1/career-taxonomy/domains/:id/education`) and linked per job role — it is not
dual-written back to the flat `qualification*`/`certifications*` strings. **Reference data is
review-gated**: counsellors may propose exams/courses/institutions/education-path entries
(staff-level POSTs), which land `PENDING` and stay out of the pickers until an admin
approves/rejects them. Review is *in place* via a shared `ReviewStatus` column on the four
tables — not a separate ticket like `CareerLibraryRequest` (job roles), which stays as it is. The student assessment **Report** is built
(`src/modules/reports/` — `GET /reports/students/:id/assessment` assembles the full report
as JSON for the frontend to render/print) and a dev scoring tester is served at
`/dev/assessment` (non-prod, `public/assessment-tester.html`, backed by
`POST /assessment/score-preview`). **Counsellor Chart** (`src/modules/counsellor-chart/`
— chart assembly, counsellor content save, mirror-pair amendments, `/finalize`) and
**Feedback** scoring (`src/modules/feedback/`) are built. The **reminder scheduler** is
built too (`src/scheduler/` — node-cron, same-day session reminders + idle nudges) but
is **off unless `SCHEDULER_ENABLED=true`**, and must stay off on serverless/multi-instance
deploys (drive `runDailyBatch` from an external cron there instead; there's no trigger
endpoint yet). **Not yet implemented**: server-side PDF rendering and parent/institution
report variants. The composite ARI now computes whenever the frontend sends per-question
`timeTakenMs` on the aptitude answers (accepted and stored since 2026-08-30); without
timing it stays `null` and is listed in the report's `meta.pending`.
Note the OpenAPI/Swagger spec (`src/config/openapi.ts`) is **hand-maintained** — add a
`registry.registerPath(...)` there when you add a route. Don't assume any of these exist — check `src/modules/` before
referencing an endpoint, and see `docs/frontend-integration-guide.md` §13 for the full
list with more detail.
