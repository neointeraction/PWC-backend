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
- `id String @id @default(cuid())` for primary keys.
- `createdAt DateTime @default(now())` / `updatedAt DateTime @updatedAt`
  on models that need audit timestamps.
- Enums in SCREAMING_SNAKE_CASE members (see `UserRole`).
- Add the reverse relation field on the parent model too (e.g. adding
  `PasswordResetToken` also needs `passwordResetTokens PasswordResetToken[]`
  on `User`).

## 3. Ensure Postgres is running

Local Homebrew Postgres (not Docker). Dev DB `pwc_counselling`, test DB
`pwc_counselling_test`, role `pwc`.

```bash
brew services start postgresql@14   # if not already running
```

## 4. Create + apply the migration

**The simple case** (new table, new nullable column, new enum — nothing that
can lose or invalidate existing data):

```bash
pnpm prisma:migrate --name <short_description>   # prisma migrate dev
```

This creates the migration, applies it to the dev DB, and regenerates the
client.

### ⚠️ Gotcha: `migrate dev` blocks non-interactively

Two situations make `prisma migrate dev` stop and wait for input (which hangs
in this environment):

1. **Adding a `NOT NULL` column to a populated table** — Prisma needs a
   default/backfill and prompts.
2. Any change it flags as potentially data-losing.

For these, use **create-only + hand-author + deploy**:

```bash
npx prisma migrate dev --name <desc> --create-only   # writes the file, does NOT apply
```

Then edit the generated `prisma/migrations/<ts>_<desc>/migration.sql` to be
safe — e.g. add the column nullable, backfill existing rows, then `SET NOT
NULL`:

```sql
ALTER TABLE "assessment_questions" ADD COLUMN "displayOrder" INTEGER;
UPDATE "assessment_questions" SET "displayOrder" = CASE ... END;
ALTER TABLE "assessment_questions" ALTER COLUMN "displayOrder" SET NOT NULL;
CREATE UNIQUE INDEX ... ;
```

## 5. Apply to BOTH databases

`migrate dev` only touches the dev DB. The **test DB must be migrated too**,
or the test suite fails against a stale schema. Use `migrate deploy` (applies
pending migrations, never prompts):

```bash
npx prisma migrate deploy                                    # dev DB (DATABASE_URL from .env)
DATABASE_URL="postgresql://pwc:pwc_dev_password@localhost:5432/pwc_counselling_test?schema=public" \
  npx prisma migrate deploy                                  # test DB
npx prisma generate                                          # regenerate client
```

(If you used `--create-only`, run both `deploy` lines to apply the file you
authored.)

## 6. Verify

- `pnpm typecheck` — confirms generated Prisma types compile against service code.
- `pnpm test` — confirms the test DB schema matches.
- Update `prisma/seed.ts` if seed data is affected, and `docs/db-design.md`
  for a meaningful schema change (per CLAUDE.md).

## Notes

- Never hand-edit a migration **after** it's been applied/committed — only the
  `--create-only` file before its first apply.
- Reference/lookup data that the app reads at runtime must **not** be JSON in a
  location `tsc` won't copy to `dist/`. Emit it as `.ts` modules (see
  `src/modules/assessment/scoring/data/*.ts`) so it compiles into the build.
- Production uses `pnpm prisma:deploy` (`migrate deploy`), never `migrate dev`.
