---
name: add-migration
description: Create and apply a Prisma migration after changing prisma/schema.prisma for the counselling platform backend. Use when the user asks to add/modify a database model, field, or enum, or to "run a migration".
---

# Add a Prisma migration

## 1. Confirm the schema change

Before editing `prisma/schema.prisma`, make sure field names, types,
nullability, and relations were explicitly confirmed by the user — don't
guess business fields (e.g. form field names, assessment scoring fields).

## 2. Edit the schema

Update `prisma/schema.prisma`. Conventions used in this project:
- Model names: PascalCase singular (`User`, `CounsellingCase`).
- `@@map("snake_case_plural")` on every model for the underlying table name.
- `id String @id @default(cuid())` for primary keys, matching existing
  models.
- `createdAt DateTime @default(now())` / `updatedAt DateTime @updatedAt`
  on models that need audit timestamps.
- Enums in SCREAMING_SNAKE_CASE members (see `UserRole`).

## 3. Ensure Postgres is running

This project uses a local Homebrew Postgres instance (not Docker):

```bash
brew services list | grep postgresql   # check it's started
brew services start postgresql@14      # if not
```

## 4. Generate and apply the migration

```bash
pnpm prisma:migrate --name <short_description>
```

This creates a migration file under `prisma/migrations/` and applies it to
the local dev database, then regenerates the Prisma client.

## 5. Verify

- Run `pnpm typecheck` to confirm generated Prisma types compile against
  any updated service code.
- If seed data is affected, update `prisma/seed.ts`.

## Notes

- Never hand-edit files under `prisma/migrations/` after they're generated.
- For production, migrations are applied with `pnpm prisma:deploy`
  (`prisma migrate deploy`), not `migrate dev`.
