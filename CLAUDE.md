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
  `forms.service.ts`, `assessment.service.ts`, `sessions.service.ts` for
  existing call sites), don't hardcode status strings elsewhere. Stages
  beyond `SESSION_2_COMPLETED` depend on modules that don't exist yet
  (Counsellor Chart/Feedback, Reports) and are only reachable via the admin
  override at `PATCH /api/v1/students/:id/workflow-status` until those are
  built.
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
pnpm prisma:migrate       # create + apply a dev migration
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
the relevant template automatically), OpenAPI/Swagger docs. **Not yet implemented**:
route-level auth enforcement (the `authenticate`/`requireRole` middleware in
`src/common/middlewares/auth.ts` exists but isn't applied to any route — every
endpoint is still open with no credentials), password reset/change, Counsellor CRUD,
Project CRUD, Career Library writes/ratification flow, assessment result/scoring
computation, Counsellor Chart editing, report generation, a scheduler/cron for
automatic same-day/nudge reminders. Don't assume any of these exist — check
`src/modules/` before referencing an endpoint, and see
`docs/frontend-integration-guide.md` §12 for the full list with more detail.
