// Human-facing date/time formatting for API responses.
//
// Datetimes are stored/served internally as UTC. For display we render in IST
// (Asia/Kolkata) — the platform's operating timezone — using a generic, locale-stable
// format: dates as "01 Aug 2026" and datetimes as "01 Aug 2026 14:30" (24-hour clock).
//
// Applied at the response layer by `formatResponseDates` (src/common/middlewares/
// formatDates.ts) to a curated set of user-facing fields; audit fields (createdAt/
// updatedAt) and token expiries keep their ISO form for machine use.

const IST_TIMEZONE = "Asia/Kolkata";

// "01 Aug 2026". en-GB gives day-month-year with a short, capitalized month.
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// "14:30" — 24-hour clock, always two digits.
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Coerce a response value to a valid Date. Accepts Date instances (Prisma's default) and
// ISO strings (some services pre-serialize, e.g. reports' generatedAt). Anything else
// (null, undefined, non-date strings) yields null so the caller leaves it untouched.
export function toDisplayDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// "01 Aug 2026". Date-only fields (@db.Date) come in as UTC midnight; IST is ahead of UTC
// so the calendar day is preserved (never rolls back a day).
export function formatDisplayDate(date: Date): string {
  return dateFormatter.format(date);
}

// "01 Aug 2026 14:30" in IST.
export function formatDisplayDateTime(date: Date): string {
  return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`;
}
