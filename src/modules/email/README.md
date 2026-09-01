# Email module

Sends transactional email through a configurable provider. Nothing in the rest of the
codebase triggers a send automatically yet — every send is a manual
`POST /api/v1/email/send` call (see `docs/frontend-integration-guide.md` §11 for the
frontend-facing contract, `docs/api-list.md` for the terse route reference).

## Configuration

Set via env vars (validated in `src/config/env.ts`, see `.env.example`):

| Var | Values | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | `console` \| `mailgun` | `console` (default) logs the email instead of sending — safe for local dev. `mailgun` sends for real. |
| `EMAIL_FROM_NAME` | string | Defaults to `Team kREATE`. |
| `EMAIL_FROM_ADDRESS` | email | Defaults to `noreply@example.com` — **must** be an address on your Mailgun sending domain (see Gotchas below), not an arbitrary address. |
| `MAILGUN_API_KEY` | string | Required when `EMAIL_PROVIDER=mailgun`. |
| `MAILGUN_DOMAIN` | string | Required when `EMAIL_PROVIDER=mailgun`. Your Mailgun sandbox or verified sending domain. |
| `MAILGUN_REGION` | `us` \| `eu` | Defaults to `us` (`api.mailgun.net`). Use `eu` for `api.eu.mailgun.net`. |
| `ADMIN_NOTIFICATION_EMAIL` | email | Defaults to `admin@kreate.local`. Fixed inbox for operational alerts not addressed to a specific student/parent/counsellor — currently only session no-show flags (`SESSION_STUDENT_NO_SHOW_ADMIN`/`SESSION_COUNSELLOR_NO_SHOW_ADMIN`). Not a lookup against `ADMIN`/`SUPER_ADMIN` users — just one configured address. |

`EMAIL_PROVIDER=mailgun` without `MAILGUN_API_KEY`/`MAILGUN_DOMAIN` fails fast at
startup (see `src/config/env.ts`).

## Architecture

```
email.routes.ts       Express routes
email.controller.ts   thin pass-through
email.service.ts      provider selection + template render + send
email.schema.ts        Zod schema for the send-email request body
providers/
  email-provider.ts     the EmailProvider interface every provider implements
  console.provider.ts    logs instead of sending (default)
  mailgun.provider.ts    real Mailgun send, via mailgun.js
templates/
  layout.ts              shared HTML shell + paragraph/heading/button helpers
  reminders.ts            factory-built reminder/session-status templates (31)
  <name>.ts               one file per rich lifecycle template (9)
  index.ts                the template registry — templateKey -> { schema, render }
```

**Adding a new provider**: implement `EmailProvider` (`providers/email-provider.ts` —
one `send(email): Promise<{ providerMessageId }>` method), then add one line to the
factory in `email.service.ts`. Nothing else changes — callers only ever see
`sendTemplateEmail(to, templateKey, data)`.

**Adding a new template**: for a one-off rich template, copy the shape of an existing
file in `templates/` (a Zod schema + a `render*Email(data)` function returning
`{ subject, html, text }`, using the `templates/layout.ts` helpers), then register it
in `templates/index.ts`. For a short reminder-style template (single paragraph,
optional CTA link), add a `reminder({ subject, schema, body, text })` entry to
`templates/reminders.ts` instead — see the existing 28 for the pattern.

## Sending an email

```bash
curl -X POST http://localhost:4000/api/v1/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "student@example.com",
    "templateKey": "WELCOME_STUDENT",
    "data": { "studentName": "Aarav" }
  }'
```

`GET /api/v1/email/templates` lists all valid `templateKey` values. A `data` object
that doesn't match the template's schema returns `400` with
`error.details.fieldErrors` listing exactly what's missing/wrong. On success: `202`
with `{ providerMessageId, subject, provider }`.

## Template reference

### Lifecycle templates (9)

Source: `docs/11.Class 910_Communication EMail Templates.pdf` — the kREATE programme's
own email copy, implemented close to verbatim.

| `templateKey` | `data` fields | PDF step |
|---|---|---|
| `WELCOME_STUDENT` | `studentName` | Step 1 — Welcome: Student |
| `WELCOME_PARENT` | `parentName`, `studentName` | Step 1 — Welcome: Parent |
| `LOGIN_CREDENTIALS_STUDENT` | `studentName`, `loginId`, `defaultPassword`, `loginLink` | Step 2 — Login Credentials: Student |
| `LOGIN_CREDENTIALS_PARENT` | `parentName`, `studentName`, `loginId`, `defaultPassword`, `loginLink` | Step 2 — Login Credentials: Parent |
| `PRE_COUNSELLING_PARENT` | `parentName`, `formLink` | Step 5 — Pre-counselling Form: Parent |
| `SESSION_DETAILS_PARENT` | `parentName`, `studentName`, `session1Date`, `session1Time`, `session1Link`, `session2Date`, `session2Time`, `session2Link` | Step 9 — Session Details: Parent |
| `FEEDBACK_REQUEST_PARENT` | `parentName`, `studentName`, `feedbackFormLink` | Step 16 — Feedback Report: Parent |
| `REPORT_READY_STUDENT` | `studentName`, `reportLink` | Step 17 — kREATE Report: Student |
| `REPORT_READY_PARENT` | `parentName`, `studentName`, `reportLink` | Step 17 — kREATE Report: Parent |

Fields typed as a link (`loginLink`, `formLink`, `session1Link`, `reportLink`, etc.)
must be a valid URL. All other fields are non-empty strings.

### Reminder & session-status templates (31)

Source: `docs/Class 910_Workflow Prompts for Watsapp.xlsx` (rows 3–16) — that sheet is
WhatsApp copy; these are the email equivalents. **WhatsApp sending is not
implemented** — only the email versions exist. Rows 1, 2 and 17 from that sheet are
covered by the lifecycle templates above, so aren't duplicated here.

Every row has a `_STUDENT` and `_PARENT` variant, sent independently (different
recipient, different wording). All link fields (`loginLink`, `portalLink`, `formLink`,
etc.) are **optional** — the template still renders as a plain-text nudge without one,
just without a call-to-action button.

Rows 9–11 (session scheduling confirmation, Session 1/2 day reminder) additionally have
a `_COUNSELLOR` variant — not part of the source WhatsApp sheet, added for the Sessions
module so the assigned counsellor gets notified alongside student/parent. Wired up
automatically by `sessions.service.ts` (`bookSessions`, `sendDayReminder`), same as the
`_STUDENT`/`_PARENT` sends for those two actions.

| `templateKey` | `data` fields | Sheet trigger (row) |
|---|---|---|
| `LOGIN_ACTIVATION_REMINDER_STUDENT` | `studentName`, `loginLink?` | 3 — Password Change Reminder |
| `LOGIN_ACTIVATION_REMINDER_PARENT` | `parentName`, `studentName` | 3 |
| `PROFILE_COMPLETION_REMINDER_STUDENT` | `studentName`, `portalLink?` | 4 — Profile Completion Reminder |
| `PROFILE_COMPLETION_REMINDER_PARENT` | `parentName`, `studentName` | 4 |
| `PRE_COUNSELLING_STUDENT_FORM_REMINDER_STUDENT` | `studentName`, `formLink?` | 5 — Pre-Counselling Form, student's own form pending |
| `PRE_COUNSELLING_STUDENT_FORM_REMINDER_PARENT` | `parentName`, `studentName` | 5 |
| `PRE_COUNSELLING_PARENT_FORM_REMINDER_STUDENT` | `studentName` | 6 — Pre-Counselling Form, parent's form pending |
| `PRE_COUNSELLING_PARENT_FORM_REMINDER_PARENT` | `parentName`, `studentName`, `formLink?` | 6 |
| `ASSESSMENT_REMINDER_STUDENT` | `studentName`, `assessmentLink?` | 7 — Assessment Reminder |
| `ASSESSMENT_REMINDER_PARENT` | `parentName`, `studentName` | 7 |
| `SESSION_SCHEDULING_REMINDER_STUDENT` | `studentName`, `schedulingLink?` | 8 — Session Scheduling Reminder |
| `SESSION_SCHEDULING_REMINDER_PARENT` | `parentName`, `studentName` | 8 |
| `SESSION_SCHEDULED_CONFIRMATION_STUDENT` | `studentName`, `sessionDateTime`, `portalLink?` | 9 — Session Scheduling Confirmation |
| `SESSION_SCHEDULED_CONFIRMATION_PARENT` | `parentName`, `studentName`, `sessionDateTime` | 9 |
| `SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR` | `counsellorName`, `studentName`, `sessionDateTime`, `portalLink?` | 9 (not in source sheet — see note above) |
| `SESSION_1_DAY_REMINDER_STUDENT` | `studentName`, `sessionTime`, `portalLink?` | 10 — Session 1 Day Reminder |
| `SESSION_1_DAY_REMINDER_PARENT` | `parentName`, `studentName`, `sessionTime` | 10 |
| `SESSION_1_DAY_REMINDER_COUNSELLOR` | `counsellorName`, `studentName`, `sessionTime`, `portalLink?` | 10 (not in source sheet — see note above) |
| `SESSION_2_DAY_REMINDER_STUDENT` | `studentName`, `sessionTime`, `portalLink?` | 11 — Session 2 Day Reminder |
| `SESSION_2_DAY_REMINDER_PARENT` | `parentName`, `studentName`, `sessionTime` | 11 |
| `SESSION_2_DAY_REMINDER_COUNSELLOR` | `counsellorName`, `studentName`, `sessionTime`, `portalLink?` | 11 (not in source sheet — see note above) |
| `SESSION_RESCHEDULED_STUDENT` | `studentName`, `sessionNumber` (`"1"` \| `"2"`), `newDateTime`, `portalLink?` | 12 — Session Rescheduled |
| `SESSION_RESCHEDULED_PARENT` | `parentName`, `studentName`, `sessionNumber`, `newDateTime` | 12 |
| `SESSION_CANCELLED_STUDENT` | `studentName`, `sessionNumber`, `originalDateTime`, `portalLink?` | 13 — Session Cancelled |
| `SESSION_CANCELLED_PARENT` | `parentName`, `studentName`, `sessionNumber`, `originalDateTime` | 13 |
| `SESSION_MISSED_STUDENT` | `studentName`, `sessionDateTime`, `portalLink?` | 14 — Session Missed (no-show). Reused as the "Admin permitted" reschedule prompt sent by `POST /sessions/:id/no-show/reschedule-prompt` after a student no-show. |
| `SESSION_MISSED_PARENT` | `parentName`, `studentName`, `sessionDateTime` | 14 |
| `SESSION_STUDENT_NO_SHOW_ADMIN` | `studentName`, `counsellorName`, `sessionNumber`, `sessionDateTime` | Not in source sheet — Admin alert fired by `POST /sessions/:id/no-show` (party `STUDENT`), see `docs/Session Handling_Cancellation  Rescheduling.pdf` §2. |
| `SESSION_COUNSELLOR_NO_SHOW_ADMIN` | `studentName`, `counsellorName`, `sessionNumber`, `sessionDateTime` | Not in source sheet — Admin alert fired by `POST /sessions/:id/no-show` (party `COUNSELLOR`), same doc §4. |
| `SESSION_COUNSELLOR_NO_SHOW_STUDENT` | `studentName`, `sessionDateTime`, `portalLink?` | Not in source sheet — apology + reschedule prompt sent automatically (no Admin gate) when the counsellor is the no-show party, same doc §4. |
| `SESSION_COUNSELLOR_RESCHEDULE_REQUEST_STUDENT` | `studentName`, `sessionNumber`, `reason`, `proposedDateTime`, `portalLink?` | Not in source sheet — sent when a counsellor proposes a reschedule (`POST /sessions/:id/reschedule-request`), see `docs/Session Handling_Cancellation  Rescheduling.pdf` §3. |
| `FEEDBACK_STUDENT_PENDING_REMINDER_STUDENT` | `studentName`, `feedbackFormLink?` | 15 — Feedback Reminder, student pending |
| `FEEDBACK_STUDENT_PENDING_REMINDER_PARENT` | `parentName`, `studentName` | 15 |
| `FEEDBACK_PARENT_PENDING_REMINDER_STUDENT` | `studentName` | 16 — Feedback Reminder, parent pending |
| `FEEDBACK_PARENT_PENDING_REMINDER_PARENT` | `parentName`, `studentName`, `feedbackFormLink?` | 16 |

`sessionDateTime`, `sessionTime`, `newDateTime`, `originalDateTime` are free-text
strings (e.g. `"12 Aug, 4:00 PM"`) — format them however you want before sending, the
template doesn't parse or reformat them.

## What's NOT done

- **No automatic triggers.** Nothing in Students/Forms/Assessment/Sessions calls
  `sendTemplateEmail` on its own — every send, including every reminder above, is a
  manual API call. A "+2 days if incomplete" reminder needs a scheduler/cron job (not
  built) that queries for students in the relevant pending state and calls
  `POST /email/send` — the template exists, the scheduling logic doesn't.
- **No WhatsApp.** `docs/Class 910_Workflow Prompts for Watsapp.xlsx` is WhatsApp
  copy; only the email versions were built here, by design (WhatsApp integration is
  explicitly deferred).
- **No delivery/open tracking persisted.** Sends are fire-and-forget from this
  service's point of view; check the provider's own dashboard (e.g. Mailgun's Logs) for
  delivery status. See `docs/db-design.md` → "Deliberate scope gaps" (notification log
  isn't modeled as a DB table).

## Gotchas

- **Mailgun sandbox domains** (`sandboxXXXX.mailgun.org`) only deliver to recipients
  you've explicitly added as "Authorized Recipients" in the Mailgun dashboard — sending
  to any other address returns a `403 Forbidden` from Mailgun, surfaced as a `500` from
  this API (the error detail in server logs will say
  `"... is not allowed to send: Free accounts are for test purposes only"`). Add
  recipients there, or move to a verified paid domain.
- **`EMAIL_FROM_ADDRESS` must match your sending domain.** If it's on a domain Mailgun
  isn't authorized for (e.g. the `noreply@example.com` default), recipients on strict-
  DMARC providers (Gmail, etc.) will bounce the email with a DMARC rejection even
  though Mailgun itself accepted it. Set it to an address on your `MAILGUN_DOMAIN`.
- Even a `delivered` event in Mailgun's logs can carry a `DMARC:Quarantine` note,
  meaning the recipient's provider routed it to spam rather than the inbox — expected
  behavior for a sandbox domain, resolved by moving to a verified custom domain with
  SPF/DKIM/DMARC set up.
