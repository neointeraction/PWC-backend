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
- **Status lifecycle**: the counselling case status lifecycle (Draft →
  Profile Completed → ... → Closed) is not yet modeled in Prisma — it will
  be added as its own module once the case/form data model is confirmed.
  Don't hardcode status strings elsewhere in the meantime.
- **Imports**: this project uses ESM with `NodeNext` module resolution —
  relative imports must include the `.js` extension (even though the
  source file is `.ts`), e.g. `import { env } from "./config/env.js"`.
- **API docs**: update `docs/api-list.md` in the same change as any route
  added, removed, or modified — it's the quick-reference companion to the
  Swagger UI (`GET /docs`). Also update `docs/db-design.md` when the Prisma
  schema changes meaningfully.

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

This is intentionally staged — we're building module by module. Not yet
implemented: auth (register/login/refresh/logout), user profile module,
dynamic forms module, assessment module, video session module (2 sessions
per case), counsellor/parent/student feedback module, case status
lifecycle + transitions, role-based authorization middleware, OpenAPI docs.
Don't assume any of these exist — check `src/modules/` before referencing
an endpoint.
