# Deploying to Vercel

This API is a long-running Express server by nature; Vercel runs it as a **serverless
function** instead. The repo is set up for that (`api/index.ts`, `vercel.json`), but
Vercel is not an ideal host for a stateful Postgres API — if you hit friction, Railway or
Render run it almost as-is (`pnpm build` → `node dist/src/server.js`).

## What's already configured in the repo

- **`api/index.ts`** — exports the Express app as the serverless handler (no `app.listen`).
- **`vercel.json`** — installs, runs `prisma generate && pnpm build`, and rewrites every
  path to the function so Express does its own routing.
- **`prisma/schema.prisma`** — `binaryTargets = ["native", "rhel-openssl-3.0.x"]` so the
  query engine works on Vercel's runtime.
- **`src/app.ts`** — helmet import hardened against a NodeNext type-resolution quirk.

## What YOU must do (can't be automated)

### 1. A hosted, POOLED Postgres

Serverless opens a new DB connection per invocation, so you **must** use a connection
pooler or you'll exhaust connections. Use Neon or Supabase:

- **Neon**: use the **pooled** connection string (host contains `-pooler`) and append
  `?sslmode=require&pgbouncer=true&connection_limit=1`.
- **Supabase**: use the **Transaction pooler** URL (port `6543`), plus
  `?pgbouncer=true&connection_limit=1`.

Keep the **direct** (non-pooled) URL too — you need it for migrations (step 3).

### 2. Environment variables (Vercel → Project → Settings → Environment Variables)

`env.ts` validates these at startup and the function crashes if any required one is
missing. Set at least:

| Var | Value |
|---|---|
| `DATABASE_URL` | the **pooled** connection string from step 1 |
| `JWT_ACCESS_SECRET` | a long random string |
| `JWT_REFRESH_SECRET` | a different long random string |
| `CORS_ORIGIN` | your frontend's URL (e.g. `https://app.example.com`) |
| `APP_WEB_URL` | frontend base URL (used in email links) |
| `EMAIL_PROVIDER` | `console` (or `mailgun` + `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`) |
| `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | first admin login |

`NODE_ENV=production` is set by Vercel automatically (this also disables the `/dev/assessment`
tester).

### 3. Run migrations against the production DB (from your machine, once per schema change)

Migrations can't run inside a serverless function. Use the **direct** (non-pooled) URL:

```bash
DATABASE_URL="<DIRECT non-pooled url>" pnpm prisma migrate deploy
```

### 4. Seed the production DB (once)

```bash
DATABASE_URL="<DIRECT non-pooled url>" pnpm db:seed
```

This seeds the super admin, the `CLASS_9_10` cohort, the 4 form templates, the 73
assessment questions, and the career library (+ normalized lookups/links).

### 5. Deploy

Push to the branch connected to Vercel, or `vercel --prod`. The build runs
`prisma generate && pnpm build`; the function serves everything.

## Gotchas / verification

- **Cross-site auth cookie**: the refresh token is an httpOnly cookie with
  `sameSite: "lax"`. If your frontend is on a **different domain** than the API, the
  browser won't send it on cross-site requests — you'd need `sameSite: "none"` +
  `secure: true` (see `refreshCookieOptions` in `auth.controller.ts`) and CORS
  `credentials: true` (already set) with an exact `CORS_ORIGIN`.
- **"Query engine binary not found"**: your Vercel runtime may be Amazon Linux 2 — switch
  the binary target to `rhel-openssl-1.0.x` and redeploy.
- **All routes 404**: confirm the `vercel.json` rewrite is present (it routes `/(.*)` →
  the function). Test `GET /health` first.
- **DB connection errors under load**: you're not using the pooled URL / `connection_limit=1`.
