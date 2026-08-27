// Calendar-day helpers in IST (Asia/Kolkata) — the platform's operating timezone (see
// src/common/utils/dateFormat.ts). IST is a fixed +5:30 offset with no DST, so a
// calendar-day number is exact integer arithmetic, no date library needed.

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

// Whole-day index of an instant in IST (days since the Unix epoch, IST-shifted). Two
// instants on the same IST calendar day share a number; the difference of two numbers is
// the calendar-day gap.
export function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);
}

// Calendar days from `from` to `now` in IST (0 if same day, negative if `from` is later).
export function calendarDaysBetween(from: Date, now: Date): number {
  return istDayNumber(now) - istDayNumber(from);
}

// The UTC-midnight Date for the IST calendar day containing `d`. This matches how Prisma
// stores `@db.Date` columns (date at UTC midnight), so it can be used to match a
// `scheduledDate` for "today in IST".
export function istDateUtcMidnight(d: Date): Date {
  return new Date(istDayNumber(d) * DAY_MS);
}
