import { describe, expect, it } from "vitest";
import {
  AGEING_FLAG_THRESHOLD_DAYS,
  computeStageInfo,
  type StudentForStage,
} from "../src/modules/students/studentStage.js";

// Fixed reference "now" so calendar-day maths is deterministic. IST is a constant offset,
// so subtracting exact 24h multiples shifts the calendar-day number by exactly that many.
const NOW = new Date("2026-08-21T06:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

// Minimal student builder — empty relations by default.
function student(overrides: Partial<StudentForStage>): StudentForStage {
  return {
    workflowStatus: "DRAFT",
    createdAt: NOW,
    updatedAt: NOW,
    formSubmissions: [],
    assessmentAttempts: [],
    sessions: [],
    user: { passwordChangedAt: null },
    ...overrides,
  };
}

const form = (formType: string, submittedAt: Date | null) => ({
  submittedAt,
  formTemplate: { formType },
});

describe("computeStageInfo — ageing & flags", () => {
  it("threshold is 2 (documented contract)", () => {
    expect(AGEING_FLAG_THRESHOLD_DAYS).toBe(2);
  });

  it("DRAFT with no login yet → Invited, aged from createdAt", () => {
    const info = computeStageInfo(student({ workflowStatus: "DRAFT", createdAt: daysAgo(5) }), NOW);
    expect(info.stage).toBe("INVITED");
    expect(info.stageLabel).toBe("Invited");
    expect(info.ageDays).toBe(5);
    expect(info.flagged).toBe(true);
    expect(info.flagReason).toBe("IDLE");
  });

  it("DRAFT after password change → Login Activated, aged from passwordChangedAt", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "DRAFT",
        createdAt: daysAgo(10),
        user: { passwordChangedAt: daysAgo(5) },
      }),
      NOW
    );
    expect(info.stage).toBe("LOGIN_ACTIVATED");
    expect(info.stageLabel).toBe("Login Activated");
    expect(info.ageDays).toBe(5);
    expect(info.flagged).toBe(true);
    expect(info.flagReason).toBe("IDLE");
  });

  it("does not flag at exactly the threshold, flags beyond it", () => {
    const at = computeStageInfo(student({ createdAt: daysAgo(2) }), NOW);
    expect(at.ageDays).toBe(2);
    expect(at.flagged).toBe(false);

    const beyond = computeStageInfo(student({ createdAt: daysAgo(3) }), NOW);
    expect(beyond.ageDays).toBe(3);
    expect(beyond.flagged).toBe(true);
  });

  it("PROFILE_COMPLETED with no forms ages from updatedAt", () => {
    const info = computeStageInfo(
      student({ workflowStatus: "PROFILE_COMPLETED", updatedAt: daysAgo(4) }),
      NOW
    );
    expect(info.stage).toBe("PROFILE_COMPLETED");
    expect(info.flagged).toBe(true);
    expect(info.flagReason).toBe("IDLE");
  });

  it("PROFILE_COMPLETED + only student pre-counselling form → Pre-Counselling — Student, aged from that form", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "PROFILE_COMPLETED",
        updatedAt: daysAgo(10), // must be ignored in favour of the form timestamp
        formSubmissions: [form("PRE_COUNSELLING_STUDENT", daysAgo(4))],
      }),
      NOW
    );
    expect(info.stage).toBe("PRE_COUNSELLING_STUDENT");
    expect(info.ageDays).toBe(4);
    expect(info.flagged).toBe(true);
  });

  it("PROFILE_COMPLETED + only parent form → Pre-Counselling — Parent (not flagged when recent)", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "PROFILE_COMPLETED",
        formSubmissions: [form("PRE_COUNSELLING_PARENT", daysAgo(1))],
      }),
      NOW
    );
    expect(info.stage).toBe("PRE_COUNSELLING_PARENT");
    expect(info.ageDays).toBe(1);
    expect(info.flagged).toBe(false);
  });

  it("both pre-counselling forms in → Assessment Pending, aged from the later form", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "PRE_COUNSELLING_FORMS_SUBMITTED",
        formSubmissions: [
          form("PRE_COUNSELLING_STUDENT", daysAgo(6)),
          form("PRE_COUNSELLING_PARENT", daysAgo(3)),
        ],
      }),
      NOW
    );
    expect(info.stage).toBe("ASSESSMENT_PENDING");
    expect(info.ageDays).toBe(3); // later of the two
    expect(info.flagged).toBe(true);
  });

  it("ASSESSMENT_COMPLETED ages from the submitted attempt", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "ASSESSMENT_COMPLETED",
        assessmentAttempts: [{ status: "SUBMITTED", submittedAt: daysAgo(5) }],
      }),
      NOW
    );
    expect(info.stage).toBe("ASSESSMENT_COMPLETED");
    expect(info.ageDays).toBe(5);
    expect(info.flagged).toBe(true);
  });

  it("Session Booked is never ageing-flagged (waiting on a scheduled date)", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_SCHEDULED",
        updatedAt: daysAgo(30),
        sessions: [{ status: "SCHEDULED", scheduledDate: daysAhead(3), studentNoShow: false }],
      }),
      NOW
    );
    expect(info.stage).toBe("SESSION_BOOKED");
    expect(info.flagged).toBe(false);
  });

  it("Session Booked with a past, still-SCHEDULED session → flagged as missed", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_SCHEDULED",
        sessions: [{ status: "SCHEDULED", scheduledDate: daysAgo(1), studentNoShow: false }],
      }),
      NOW
    );
    expect(info.flagged).toBe(true);
    expect(info.flagReason).toBe("MISSED_SESSION");
  });

  it("explicit student no-show → flagged as missed", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_SCHEDULED",
        sessions: [{ status: "SCHEDULED", scheduledDate: daysAhead(1), studentNoShow: true }],
      }),
      NOW
    );
    expect(info.flagReason).toBe("MISSED_SESSION");
  });

  it("a completed past session is not 'missed'", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_1_COMPLETED",
        updatedAt: daysAgo(20),
        sessions: [{ status: "COMPLETED", scheduledDate: daysAgo(5), studentNoShow: false }],
      }),
      NOW
    );
    expect(info.stage).toBe("SESSION_1_COMPLETED");
    expect(info.flagged).toBe(false); // staff-side stage, session was completed
  });

  it("STUDENT_PARENT_FEEDBACK + only student feedback → Feedback — Student", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "STUDENT_PARENT_FEEDBACK",
        formSubmissions: [form("FEEDBACK_STUDENT", daysAgo(4))],
      }),
      NOW
    );
    expect(info.stage).toBe("FEEDBACK_STUDENT");
    expect(info.flagged).toBe(true);
  });

  it("CLOSED is never flagged, even with a missed session on record", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "CLOSED",
        sessions: [{ status: "SCHEDULED", scheduledDate: daysAgo(10), studentNoShow: true }],
      }),
      NOW
    );
    expect(info.stage).toBe("CLOSED");
    expect(info.flagged).toBe(false);
  });
});
