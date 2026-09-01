# Session Scheduling — Use Cases & Flow

Working document to align on the full session-scheduling flow before we build the
`Session` module (routes/controller/service — currently schema-only, no API exists
yet). Compiled from the Functional Specification Document, the Prompt Engineering
Doc, the current Prisma schema (`Session`, `CounsellorAvailability`,
`ProjectCounsellor`), and a direct walkthrough from the user (2026-08-06) that
resolved most of the open questions below — see "Resolved decisions" first, then the
use cases, then the remaining open questions.

## Resolved decisions (2026-08-06 walkthrough)

These override anything conflicting stated further down or in the source documents.

1. **Availability is not a recurring weekly pattern.** It's a discrete, per-date slot
   list fed into the system **at project creation**, one row per bookable slot
   instance: `Counsellor ID, Counsellor Name, Date, Day, Time Slot, Start Time, End
   Time`. This replaces the current `CounsellorAvailability` model (which stores a
   recurring `daysOfWeek[] + startTime/endTime` rule) — we need a new model
   representing discrete, individually-bookable slots instead.
2. **Booking is blind, confirmed.** The student never sees or selects a counsellor.
   The student picks a date/time; the backend assigns whichever counsellor has an
   open slot matching that date/time.
3. **Session 1 and Session 2 are booked together, in one flow**, not sequentially.
4. **Both sessions must be the same counsellor.** The counsellor assigned via the
   Session 1 slot is locked in for Session 2 — Session 2's slot choices are
   restricted to that same counsellor's open slots.
5. **Minimum 2-day gap between Session 1 and Session 2** dates.
6. **Reschedule uses the same assignment logic** — blind date/time pick, same
   counsellor constraint, same 2-day-gap rule apply to a rescheduled session too.
7. **Join tracking is required.** The app needs to know whether the student and
   counsellor actually joined. Both must be logged into the app; the "Join Now"
   button enables ~10 minutes before `startTime`, and only clicking it reveals the
   meeting link — that click is the join event to record.
8. **Parent notification is separate from the join flow.** Parents get an emailed
   link directly (no app login, no "Join Now" gating) when the session is confirmed.

## Actors

| Actor | Has login? | Role in scheduling |
|---|---|---|
| Student | Yes | Books their own Session 1 & 2, joins calls |
| Counsellor | Yes | Submits availability, gets assigned via booking, edits notes, joins calls |
| Admin (PWC staff) | Yes | Oversees all sessions across institutes/projects, resolves conflicts, shares video links |
| Super Admin | Yes | Platform-wide monitoring; not session-scheduling-specific |
| Parent | No — link-based | Joins as observer via a time-limited emailed link; no booking role |

## Session lifecycle

Each student gets exactly **2** sessions per project (`Session.sessionNumber`:
`SESSION_1` | `SESSION_2` — unique per student). A session has:
`scheduledDate, startTime, endTime, status (SCHEDULED/COMPLETED/RESCHEDULED/CANCELLED),
notes, cancellationReason, cancellationNotes, rescheduledFromDate/Start` — plus,
pending the schema update, a meeting link and `studentJoinedAt`/`counsellorJoinedAt`
join-tracking timestamps (see "Resolved decisions" #7 and open question D/E).

**Availability model is changing.** The current `CounsellorAvailability` (a recurring
weekly window: `daysOfWeek[], startTime, endTime`, scoped per counsellor+project) does
**not** match the real flow — availability is actually a discrete, per-date slot list
uploaded at project creation (see the sample sheet: `Counsellor ID, Counsellor Name,
Date, Day, Time Slot, Start Time, End Time`, one row per bookable instance). This will
be replaced by a table representing individually bookable slots, each either open or
consumed by a booked `Session`. `ProjectCounsellor` (which counsellors are assigned to
a project) stays as-is.

---

## Use cases by role

### Counsellor

1. **Submit monthly/recurring availability** for a project they're assigned to (8:00
   AM–8:00 PM, Mon–Sat per the FSD) — maps to creating `CounsellorAvailability` rows.
   Supports multiple slots per day (split shifts).
2. **View my upcoming/blocked sessions** — dashboard list of assigned sessions,
   filterable by status (Upcoming / Completed / Cancelled).
3. **Join a session** — "Join Now" activates ~10 minutes before `startTime`; opens the
   externally-shared video link (Zoom or equivalent — no in-app video, links shared
   manually by Admin per FSD).
4. **View/edit the Counsellor Chart during a session** — not part of `Session` itself,
   but the live-editing workflow happens *during* a scheduled session (strengths,
   hobbies, career shortlist).
5. **Add session notes** after/during a call (`Session.notes`).
6. **Reschedule or cancel a session** they're assigned to, with a reason
   (`cancellationReason`: STUDENT_UNAVAILABLE / COUNSELLOR_UNAVAILABLE /
   INSTITUTION_REQUEST / OTHER) and free-text notes.
7. **View assigned-student list with form/session status** — "My Students" table
   (class, mobile, parent name, form completion count) — adjacent context, not
   scheduling itself, but informs which students are ready to book.

### Student

8. **Unlock session booking** only after both pre-counselling forms (student +
   parent) and the assessment are submitted (workflow-status gated —
   `ASSESSMENT_COMPLETED` before `SESSION_SCHEDULED`).
9. **Book Session 1** by picking an open date/time slot. **[OPEN — see "Booking flow
   conflict" below]** — either blind (counsellor identity hidden, derived from the
   chosen slot) or with the counsellor already visible/pre-assigned.
10. **Book Session 2** — must be the **same counsellor** as Session 1. One source doc
    says this is booked together with Session 1 in a single step (min. 2-day gap
    enforced); another says Session 2 booking only opens after Session 1 completes,
    filtered to that counsellor's remaining slots. **[OPEN]**
11. **View my sessions** — "My Counselling Sessions": date/time, mode, countdown to
    "Join Now", link to reschedule request, link to view pre-form status.
12. **Join a session** — same "Join Now" (~10 min early activation) pattern as
    counsellor.
13. **Request a reschedule** — cancellation/reschedule allowed up to a 24-hour cutoff
    before the session per the FSD.
14. **See Session 2 locked** until Session 1 is marked complete (UI state, not
    necessarily a hard workflow gate — worth confirming).

### Admin (PWC staff)

15. **View all scheduled sessions** across institutes/projects — list view (search by
    student/counsellor, filter by institution/status/date range) and calendar view.
16. **Create a session manually** (`+ New Session`) — e.g. for edge cases outside
    normal self-service booking.
17. **View/edit a session's details** — student, counsellor, date/time, session type,
    status, notes/agenda.
18. **Reschedule a session** on behalf of either party.
19. **Cancel a session** — pick a reason, optional notes, choose who to notify
    (Student / Parent / Counsellor checkboxes), confirm (irreversible, moves to
    Cancelled).
20. **Share video-conferencing links manually** — FSD states Admin shares Zoom links
    (no direct API integration in Phase 1); unclear if this happens per-session via
    the app or entirely outside it. **[OPEN]**
21. **Resolve scheduling conflicts** — e.g. two students both selecting the same
    counsellor slot; oversight role implied by FSD's "Session booking oversight: slot
    creation, conflict resolution, monitoring."
22. **Monitor session stats** on the dashboard — sessions this week, pending reports,
    per-counsellor session counts.

### Parent

23. **Receive a session reminder email** ~10 minutes before start, with a "Join
    Session" link that activates at T-minus-10 — for both Session 1 and Session 2.
24. **Join as an observer** — explicitly "at the counsellor's discretion" per the FSD;
    not a guaranteed participant role.
25. No booking/reschedule/cancel actions — parents are notification-only in the
    scheduling flow.

---

## Cross-role flow (as currently understood)

```
Admin creates a Project and uploads the counsellor slot sheet
(Counsellor ID, Date, Time Slot → discrete bookable slots, this project only — B open)
        │
        ▼
Admin assigns counsellors to the Project (ProjectCounsellor)
        │
        ▼
Student completes profile → pre-counselling forms (self + parent) → assessment
        │  (workflow status reaches ASSESSMENT_COMPLETED)
        ▼
Student picks a date/time for Session 1 (blind — no counsellor shown)
        │
        ▼
Backend finds an open slot at that date/time → assigns that counsellor (tie-break rule — A open)
        │
        ▼
Student picks a date/time for Session 2, filtered to the SAME counsellor's open
slots, ≥ 2 days after Session 1 (gap definition — F open)
        │
        ▼
Both sessions created together. Email to student + counsellor with date/time;
separate emailed link to parent (no app login) — B/G open on persistence
        │
        ▼
T-minus-10-min: student and counsellor "Join Now" buttons enable
        │
        ▼
Each party clicks "Join Now" → studentJoinedAt / counsellorJoinedAt recorded,
meeting link revealed (link source — D open)
        │
        ▼
Session 1 occurs (external video call) → counsellor edits Counsellor Chart live → notes saved
        │
        ▼
Session 2 occurs (same counsellor) → chart finalized → career shortlist narrowed to 2
        │
        ▼
Report generation unlocks (pending both feedback forms)
```

Reschedule re-enters the "pick a date/time" step for whichever session is being
moved, always keeping the counsellor that's already locked in for that student (see
resolved decision C below) and the same 2-day-gap rule.

Reschedule/cancel can happen at any point before a session's `scheduledDate`+`startTime`
(subject to the 24-hour cutoff mentioned for student-initiated changes), by student,
counsellor, or Admin. If a counsellor becomes unavailable after a slot was booked,
Admin cancels the affected session(s) — see resolved decision H below.

---

## Open questions

### Resolved by the 2026-08-06 walkthrough (kept for history)

1. ~~Booking flow: blind vs. pre-assigned?~~ → **Blind**, confirmed.
2. ~~Session 1 & 2 booking timing?~~ → **Booked together**, one flow.
3. ~~Slot inventory: computed live vs. pre-published?~~ → **Pre-published**: a
   discrete slot list is uploaded per project at creation time (see resolved
   decision #1). This is a bigger schema change than it sounds — replaces the
   recurring-pattern `CounsellorAvailability` model with a discrete, bookable
   `CounsellorSlot`-style table.

### Resolved by the 2026-08-06 follow-up

A. **Tie-breaking** → **first available**, in upload/creation order. No
   load-balancing logic needed — just the earliest-created open slot matching the
   chosen date/time among the project's assigned counsellors.
B. **Slot upload scope** → **single upload only, ever.** The sheet is uploaded once
   at project creation; that's the complete, final slot inventory for the project. No
   "add more slots later" flow to build.
D. **Meeting link** → **deferred (resolved 2026-08-06).** Real Calendly/Google Meet
   integration is not being built now — no Calendly API access or per-counsellor
   Google Meet linkage exists yet, so there's nothing to integrate against today.
   `Session.meetingLink` will be a plain, opaque string field: populated manually
   (e.g. Admin pastes a link) or left blank initially. Whether/how Calendly fits in —
   as a link-generator invoked after our own blind-assignment decides the
   date/time/counsellor, vs. Calendly owning availability itself (which would conflict
   with the already-decided single-upload discrete slot sheet) — is an open question
   for a future, separate integration project. Nothing about this blocks building the
   Session module now.
   **Superseded 2026-09-01**: the per-session field was dropped. Each counsellor has
   one fixed meeting link (`Counsellor.meetingLink`), and every session assigned to
   them resolves to that same link — no more per-session `PATCH .../meeting-link`.
   Same plain-opaque-string, no-integration shape; just moved up one level.
F. **2-day gap** → **calendar days between session dates** (e.g. Session 1 = Aug 4 →
   Session 2 earliest Aug 6), not a strict 48-hours-between-start-times rule.

### Resolved by the 2026-08-06 second follow-up

C. **Reschedule + already-locked counsellor** → **Yes, always the same counsellor.**
   Once either session exists for a student, the assigned counsellor never changes via
   reschedule — only the date/time can move. Enforced server-side when picking the new
   slot (must belong to the already-locked counsellor).
E. **"Join Now" window** → **stays open until the session's `endTime`**, not just the
   10-minute pre-window. A party can join late, any time up to the scheduled end.
E (no-show) → **explicit no-show tracking is needed**, not just inferred from a null
   join timestamp. Schema plan: keep `studentJoinedAt`/`counsellorJoinedAt` (needed
   regardless, per resolved decision #7) **and** add explicit `studentNoShow` /
   `counsellorNoShow` boolean flags — set once the session's `endTime` has passed with
   no corresponding join timestamp. *Still to decide at build time (not blocking the
   doc): is that flag set by a background job / on next read, or does Admin mark it
   manually?*
G. **Notify-on-cancel / reschedule** → **fire-and-forget, no persisted log.** Matches
   the rest of the app for now (already a documented gap in `docs/db-design.md`).
H. **Conflict resolution** → **still a real scenario**, handled through the existing
   cancel/reschedule flow: if a counsellor becomes unavailable after students already
   booked their slot, Admin cancels the affected session(s) and the student re-books.
   No separate "conflict" feature/table needed — it's just Admin-initiated
   cancellation like any other.
I. **Parent "join as observer"** → **same `meetingLink` as the student**, emailed to
   the parent. No separate per-parent token/access-control to build.

---

## Status: all questions resolved — ready to design the schema

Planned schema changes for the `Session` module:

- Replace `CounsellorAvailability` (recurring weekly pattern) with a discrete,
  per-date, individually-bookable slot table — populated by a single bulk import per
  project, never added to afterward (resolved decisions #1 and B).
- `Session` gains: `meetingLink` (plain string, manually populated for now — real
  Calendly/Google Meet integration deferred, resolved decision D),
  `studentJoinedAt` / `counsellorJoinedAt` (nullable timestamps, set on "Join Now"),
  `studentNoShow` / `counsellorNoShow` (booleans, set once `endTime` passes with no
  matching join timestamp).
- Booking logic: blind date/time pick → first-available matching slot (upload order)
  among the project's assigned counsellors → same counsellor locked for Session 2
  (≥2 calendar days later) and for any future reschedule of either session (resolved
  decisions A, C, F).
- "Join Now" stays active from T-minus-10-minutes through the session's `endTime`
  (resolved decision E).
- Counsellor-unavailable-after-booking is handled via ordinary Admin
  cancel/reschedule — no separate "conflict" feature (resolved decision H).
- Parent gets the same `meetingLink` as the student, via email (resolved decision I).
- No new tables needed for notifications — fire-and-forget email, no persisted log
  (resolved decision G).

Next: implement — new discrete-slot Prisma model, `Session` field additions, and the
booking/reschedule/join/cancel endpoints.
