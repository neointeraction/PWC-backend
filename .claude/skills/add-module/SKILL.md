---
name: add-module
description: Scaffold a new feature module (routes, controller, service, Zod schema) following this project's modular-monolith conventions. Use when adding a new domain area to the counselling platform API (e.g. "add a forms module", "create the assessment module").
---

# Add a new feature module

This project organizes code by feature under `src/modules/<name>/`, per
[CLAUDE.md](../../CLAUDE.md). Follow these steps when asked to add a new
module.

## 1. Clarify scope first

Do not assume field names, validation rules, or business logic. Before
writing code, confirm with the user:
- What data does this module own (fields, relations to `User` or other
  existing Prisma models)?
- What roles can access which endpoints (student/counsellor/admin/super
  admin)?
- Does this module need new Prisma models/enums? If so, get exact field
  names and types before editing `prisma/schema.prisma`.

## 2. Scaffold files

Create `src/modules/<name>/` with:

- `<name>.schema.ts` — Zod schemas for request bodies/params/query, and
  `z.infer<>` types exported for reuse in the service/controller.
- `<name>.service.ts` — business logic, Prisma calls. Import `prisma` from
  `../../config/prisma.js`. Throw `AppError` subclasses
  (`src/common/errors/AppError.ts`) for expected failure cases — never
  return raw error objects.
- `<name>.controller.ts` — thin: parses `req`, calls the service, sends
  the response. No business logic here.
- `<name>.routes.ts` — an Express `Router()`. Wrap every async handler
  with `asyncHandler()` from `src/common/utils/asyncHandler.ts`. Apply
  `validate({ body, params, query })` from
  `src/common/middlewares/validate.ts` before the controller.

## 3. Wire it up

Mount the new router in `src/app.ts` under `/api/v1/<name>`.

## 4. Prisma changes (if any)

If new models/enums are needed, edit `prisma/schema.prisma`, then run the
`add-migration` skill rather than running `prisma migrate` ad hoc.

## 5. Tests

Add `test/<name>.test.ts` using `supertest` against `createApp()`,
following the pattern in `test/health.test.ts`.
