import type { RequestHandler } from "express";
import { formatDisplayDate, formatDisplayDateTime, toDisplayDate } from "../utils/dateFormat.js";

// User-facing date/time fields, keyed by field name, that responses render in the generic
// display format (see src/common/utils/dateFormat.ts). Any field NOT listed here (notably
// the audit fields createdAt/updatedAt and token expiresAt/revokedAt/usedAt) keeps its
// default ISO serialization for machine use.
//
// Calendar-date fields → "01 Aug 2026". These map to @db.Date columns plus the project
// window bounds, which are conceptually dates, not instants.
const DATE_ONLY_KEYS = new Set(["slotDate", "scheduledDate", "rescheduledFromDate", "fromDate", "toDate"]);

// Instant fields → "01 Aug 2026 14:30" (IST, 24h).
const DATE_TIME_KEYS = new Set([
  "studentJoinedAt",
  "counsellorJoinedAt",
  "submittedAt",
  "startedAt",
  "finalizedAt",
  "generatedAt",
  "reviewedAt",
  "overriddenAt",
]);

// Recursively rewrites the listed date fields in place. Bodies are freshly built per
// request, so in-place mutation is safe and avoids cloning large lists (e.g. the career
// library). Date instances are objects, so they're skipped by the object branch.
function formatDatesInPlace(node: unknown): unknown {
  if (node === null || typeof node !== "object" || node instanceof Date) return node;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) formatDatesInPlace(node[i]);
    return node;
  }

  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    const isDateOnly = DATE_ONLY_KEYS.has(key);
    if (isDateOnly || DATE_TIME_KEYS.has(key)) {
      const date = toDisplayDate(value);
      // Leave non-dates (e.g. null for a nullable field) exactly as they are.
      if (date) record[key] = isDateOnly ? formatDisplayDate(date) : formatDisplayDateTime(date);
    } else {
      formatDatesInPlace(value);
    }
  }
  return node;
}

// Wraps res.json so every response passing through it has its user-facing date fields
// rendered in the generic display format. Mounted once, app-wide.
export function formatResponseDates(): RequestHandler {
  return (_req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => originalJson(formatDatesInPlace(body));
    next();
  };
}
