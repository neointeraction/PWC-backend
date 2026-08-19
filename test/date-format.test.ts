import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { formatResponseDates } from "../src/common/middlewares/formatDates.js";
import { formatDisplayDate, formatDisplayDateTime } from "../src/common/utils/dateFormat.js";

describe("date display formatting", () => {
  it("formats a calendar date as 'DD Mon YYYY'", () => {
    expect(formatDisplayDate(new Date("2026-08-01T00:00:00.000Z"))).toBe("01 Aug 2026");
  });

  it("formats an instant as 'DD Mon YYYY HH:mm' in IST (24h)", () => {
    // 09:00 UTC -> 14:30 IST
    expect(formatDisplayDateTime(new Date("2026-08-01T09:00:00.000Z"))).toBe("01 Aug 2026 14:30");
    // crosses midnight in IST -> next calendar day
    expect(formatDisplayDateTime(new Date("2026-08-01T20:00:00.000Z"))).toBe("02 Aug 2026 01:30");
  });

  it("rewrites only the user-facing date fields in a response, leaving audit fields ISO", async () => {
    const app = express();
    app.use(formatResponseDates());
    app.get("/x", (_req, res) => {
      res.json({
        scheduledDate: new Date("2026-08-01T00:00:00.000Z"), // date-only field
        studentJoinedAt: new Date("2026-08-01T09:00:00.000Z"), // instant field
        rescheduledFromDate: null, // nullable -> untouched
        createdAt: new Date("2026-08-01T09:00:00.000Z"), // audit -> ISO
        nested: [{ generatedAt: new Date("2026-08-01T09:00:00.000Z") }],
      });
    });

    const res = await request(app).get("/x");
    expect(res.body.scheduledDate).toBe("01 Aug 2026");
    expect(res.body.studentJoinedAt).toBe("01 Aug 2026 14:30");
    expect(res.body.rescheduledFromDate).toBeNull();
    expect(res.body.createdAt).toBe("2026-08-01T09:00:00.000Z"); // unchanged
    expect(res.body.nested[0].generatedAt).toBe("01 Aug 2026 14:30"); // nested + array
  });
});
