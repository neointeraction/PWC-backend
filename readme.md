# Counselling Platform Backend

Node.js / Express / TypeScript API for the kREATE counselling platform (students,
counsellors, admins), backed by Prisma + PostgreSQL.

- **Architecture & conventions:** [CLAUDE.md](CLAUDE.md)
- **Route reference:** [docs/api-list.md](docs/api-list.md) (and Swagger UI at `/docs`)
- **Frontend integration:** [docs/frontend-integration-guide.md](docs/frontend-integration-guide.md)
- **Database design:** [docs/db-design.md](docs/db-design.md)
- **Deployment:** [docs/deploy-vercel.md](docs/deploy-vercel.md)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | >= 22 | enforced by `engines` in `package.json` |
| pnpm | 9+ | this repo uses a pnpm lockfile — don't mix in npm/yarn |
| PostgreSQL | 14+ | local dev runs against Homebrew Postgres, not Docker |

Start Postgres locally:

```bash
brew services start postgresql@14
```

Create the role and the two databases (dev + test) once:

```bash
createuser -s pwc && psql -c "ALTER USER pwc WITH PASSWORD 'pwc_dev_password'" && createdb -O pwc pwc_counselling && createdb -O pwc pwc_counselling_test
```

## First-time setup

```bash
pnpm install
```

```bash
cp .env.example .env
```

`.env.example` is the full list of supported variables — every one of them is validated
by a Zod schema in [src/config/env.ts](src/config/env.ts), so a missing or malformed
value fails loudly at startup instead of surfacing later as a runtime bug. The defaults
in the example file are ready for local dev; the only ones you normally have to think
about are `DATABASE_URL` and, if you want real email sends, the Mailgun block.

Apply the schema and generate the Prisma client:

```bash
pnpm prisma:migrate
```

Seed reference data and demo logins:

```bash
pnpm db:seed
```

The seed is idempotent and non-destructive — safe to re-run. It creates the SUPER_ADMIN
(from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`), the cohorts and languages,
all four form templates, the Class 9–10 assessment question bank, and the career library.

It seeds **no demo accounts or demo project** — a freshly seeded database contains the
SUPER_ADMIN and reference data only. There is no self-register endpoint — every real
account is created by an admin, so the seeded SUPER_ADMIN is the only way to bootstrap a
fresh environment.

Databases seeded before the demo data was removed still carry those rows; clear them once
with `pnpm tsx prisma/cleanup-demo.ts` (add `--yes` to apply — it dry-runs by default).

## Running

```bash
pnpm dev
```

Starts the API on `http://localhost:4000` (`PORT`) with hot reload via `tsx watch`.

Once it's up:

| URL | What it is |
|---|---|
| `http://localhost:4000/health` | liveness check — `{ status: "ok", timestamp }` |
| `http://localhost:4000/docs` | Swagger UI |
| `http://localhost:4000/docs/openapi.json` | raw OpenAPI document |
| `http://localhost:4000/api/v1/...` | the API itself |
| `http://localhost:4000/dev/assessment` | assessment scoring tester (non-production only) |

Quick smoke test — log in as the seeded SUPER_ADMIN (substitute your own
`SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`):

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"superadmin@kreate.local","password":"ChangeMe123!"}'
```

The access token comes back in the JSON body; the refresh token is set as an httpOnly
cookie. Send the access token as `Authorization: Bearer <token>` on every subsequent
call — route-level auth is enforced across all modules (the parent-facing forms are the
deliberate exception, since parents have no login).

### Production-style run

```bash
pnpm build && pnpm start
```

`pnpm build` compiles to `dist/`, `pnpm start` runs `node dist/src/server.js`. Use
`pnpm prisma:deploy` (not `prisma:migrate`) to apply migrations in any deployed
environment — it applies committed migrations without trying to author new ones.

### The scheduler

Reminder and nudge emails run on an in-process cron ([src/scheduler](src/scheduler)),
**off by default** so it never fires from tests or serverless invocations. Enable it only
where the app runs as a single long-lived process:

```bash
SCHEDULER_ENABLED=true pnpm dev
```

It then runs on `SCHEDULER_CRON` (default `0 8 * * *`) in `SCHEDULER_TIMEZONE` (default
`Asia/Kolkata`).

### Email in local dev

`EMAIL_PROVIDER=console` (the default) prints emails to stdout instead of sending them —
you can exercise the whole lifecycle without a provider account. Switch to
`EMAIL_PROVIDER=mailgun` and set `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` to send for real;
startup fails fast if the provider is `mailgun` and those are missing. See
[src/modules/email/README.md](src/modules/email/README.md).

## Testing

```bash
pnpm test
```

Vitest + supertest, run against the **separate** `pwc_counselling_test` database (wired up
in [test/setup.ts](test/setup.ts)) — your dev data is never touched. `pnpm test:watch`
for watch mode.

Migrations are not applied to the test database automatically. After any schema change,
sync it before running the suite, or you'll see a wave of unrelated-looking 500s:

```bash
DATABASE_URL="postgresql://pwc:pwc_dev_password@localhost:5432/pwc_counselling_test?schema=public" pnpm prisma migrate deploy
```

Type-check without emitting:

```bash
pnpm typecheck
```

## Command reference

| Command | What it does |
|---|---|
| `pnpm dev` | run the API with hot reload |
| `pnpm build` / `pnpm start` | compile to `dist/` / run the compiled server |
| `pnpm test` / `pnpm test:watch` | run the test suite / watch mode |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm prisma:migrate` | create + apply a dev migration |
| `pnpm prisma:deploy` | apply committed migrations (deployed envs, test DB) |
| `pnpm prisma:generate` | regenerate the Prisma client after a schema change |
| `pnpm prisma:studio` | browse the database in Prisma Studio |
| `pnpm db:seed` | seed reference data + demo logins (idempotent) |

## Troubleshooting

- **`Invalid environment variables` at startup** — the Zod check in `src/config/env.ts`
  rejected something; the log lists the offending keys. Compare your `.env` against
  `.env.example`.
- **`Can't reach database server at localhost:5432`** — Postgres isn't running:
  `brew services start postgresql@14`.
- **Prisma client type errors after editing `schema.prisma`** — run `pnpm prisma:generate`
  (`pnpm prisma:migrate` does it for you).
- **Tests fail en masse with 500s** — the test database is behind on migrations; run the
  `prisma migrate deploy` command in [Testing](#testing) above.
- **A route 404s that you expect to exist** — the platform is built module by module.
  Check `src/modules/` and the "What's not built yet" section of [CLAUDE.md](CLAUDE.md).
