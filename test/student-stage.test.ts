import { describe, expect, it } from "vitest";
import {
  AGEING_FLAG_THRESHOLD_DAYS,
  computeStageInfo,
  reportStageLabel,
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

  // Nothing in the product ever calls POST /sessions/{id}/complete, so a genuinely
  // attended session's real status/workflowStatus stays SCHEDULED forever — the admin
  // dashboard has to work this out live from who joined and whether it's over, not wait
  // on a write that never happens (see isSessionLiveCompleted in studentStage.ts).
  describe("live session completion (both joined + ended), no /complete call needed", () => {
    it("Session 1 both joined and ended → shows Session 1 Completed, not missed", () => {
      const info = computeStageInfo(
        student({
          workflowStatus: "SESSION_SCHEDULED",
          sessions: [
            {
              sessionNumber: "SESSION_1",
              status: "SCHEDULED",
              scheduledDate: daysAgo(1),
              endTime: "10:00",
              studentJoinedAt: daysAgo(1),
              counsellorJoinedAt: daysAgo(1),
              studentNoShow: false,
            },
          ],
        }),
        NOW
      );
      expect(info.stage).toBe("SESSION_1_COMPLETED");
      expect(info.flagged).toBe(false);
    });

    it("Session 1 ended but only the student joined → stays Session Booked and flagged as missed", () => {
      const info = computeStageInfo(
        student({
          workflowStatus: "SESSION_SCHEDULED",
          sessions: [
            {
              sessionNumber: "SESSION_1",
              status: "SCHEDULED",
              scheduledDate: daysAgo(1),
              endTime: "10:00",
              studentJoinedAt: daysAgo(1),
              counsellorJoinedAt: null,
              studentNoShow: false,
            },
          ],
        }),
        NOW
      );
      expect(info.stage).toBe("SESSION_BOOKED");
      expect(info.flagged).toBe(true);
      expect(info.flagReason).toBe("MISSED_SESSION");
    });

    it("Session 1 both joined but not ended yet → stays Session Booked", () => {
      const info = computeStageInfo(
        student({
          workflowStatus: "SESSION_SCHEDULED",
          sessions: [
            {
              sessionNumber: "SESSION_1",
              status: "SCHEDULED",
              scheduledDate: daysAhead(1),
              endTime: "10:00",
              studentJoinedAt: NOW,
              counsellorJoinedAt: NOW,
              studentNoShow: false,
            },
          ],
        }),
        NOW
      );
      expect(info.stage).toBe("SESSION_BOOKED");
    });

    it("both sessions live-completed while workflowStatus is still SESSION_SCHEDULED → Session 2 Completed", () => {
      const info = computeStageInfo(
        student({
          workflowStatus: "SESSION_SCHEDULED",
          sessions: [
            {
              sessionNumber: "SESSION_1",
              status: "SCHEDULED",
              scheduledDate: daysAgo(5),
              endTime: "10:00",
              studentJoinedAt: daysAgo(5),
              counsellorJoinedAt: daysAgo(5),
              studentNoShow: false,
            },
            {
              sessionNumber: "SESSION_2",
              status: "SCHEDULED",
              scheduledDate: daysAgo(1),
              endTime: "10:00",
              studentJoinedAt: daysAgo(1),
              counsellorJoinedAt: daysAgo(1),
              studentNoShow: false,
            },
          ],
        }),
        NOW
      );
      expect(info.stage).toBe("SESSION_2_COMPLETED");
      expect(info.flagged).toBe(false);
    });

    it("workflowStatus already SESSION_1_COMPLETED, Session 2 live-completed → Session 2 Completed", () => {
      const info = computeStageInfo(
        student({
          workflowStatus: "SESSION_1_COMPLETED",
          sessions: [
            {
              sessionNumber: "SESSION_2",
              status: "SCHEDULED",
              scheduledDate: daysAgo(1),
              endTime: "10:00",
              studentJoinedAt: daysAgo(1),
              counsellorJoinedAt: daysAgo(1),
              studentNoShow: false,
            },
          ],
        }),
        NOW
      );
      expect(info.stage).toBe("SESSION_2_COMPLETED");
    });

    it("a CANCELLED Session 1 row, even with both joins set, isn't picked as the active Session 1", () => {
      const info = computeStageInfo(
        student({
          workflowStatus: "SESSION_SCHEDULED",
          sessions: [
            {
              sessionNumber: "SESSION_1",
              status: "CANCELLED",
              scheduledDate: daysAgo(1),
              endTime: "10:00",
              studentJoinedAt: daysAgo(1),
              counsellorJoinedAt: daysAgo(1),
              studentNoShow: false,
            },
          ],
        }),
        NOW
      );
      expect(info.stage).toBe("SESSION_BOOKED");
    });
  });

  // No dedicated report row exists for "both feedback forms submitted" — once both are
  // in, the parent's submission is what determines the row (Feedback — Parent), not a
  // separate stage. Previously this fell straight to FEEDBACK_PENDING (folds to "Session
  // 2 Completed" in the admin report) once both forms were in, since no "both submitted"
  // branch existed at all — a student who'd actually finished both feedback forms still
  // showed as stuck at Session 2 (the reported bug).
  it("STUDENT_PARENT_FEEDBACK + both feedback forms in → Feedback — Parent (parent wins), not Feedback Pending", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "STUDENT_PARENT_FEEDBACK",
        formSubmissions: [form("FEEDBACK_STUDENT", daysAgo(3)), form("FEEDBACK_PARENT", daysAgo(1))],
      }),
      NOW
    );
    expect(info.stage).toBe("FEEDBACK_PARENT");
    expect(info.stageLabel).toBe("Feedback — Parent");
    expect(info.ageDays).toBe(1); // aged from the parent's submission, not the student's
    expect(reportStageLabel(info.stage)).toBe("Feedback — Parent");
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

  // Submitting one feedback form alone advances nothing (FORM_PAIRS in
  // forms.service.ts) — workflowStatus stays SESSION_2_COMPLETED until BOTH sides are
  // in, so that's the workflowStatus a student sits at while only one has submitted.
  // Without differentiating here, an already-submitted student feedback form was
  // invisible to admin (see the "Session 2 Completed" bug report).
  it("SESSION_2_COMPLETED with only the student's feedback in → Feedback — Student, actionable", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_2_COMPLETED",
        formSubmissions: [form("FEEDBACK_STUDENT", daysAgo(3))],
      }),
      NOW
    );
    expect(info.stage).toBe("FEEDBACK_STUDENT");
    expect(info.ageDays).toBe(3);
    expect(info.flagged).toBe(true);
    expect(info.flagReason).toBe("IDLE");
  });

  it("SESSION_2_COMPLETED with only the parent's feedback in → Feedback — Parent, actionable", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_2_COMPLETED",
        formSubmissions: [form("FEEDBACK_PARENT", daysAgo(1))],
      }),
      NOW
    );
    expect(info.stage).toBe("FEEDBACK_PARENT");
    expect(info.flagged).toBe(false); // only 1 day idle, under the threshold
  });

  it("SESSION_2_COMPLETED with neither feedback form in → stays Session 2 Completed, not ageing-flagged", () => {
    const info = computeStageInfo(student({ workflowStatus: "SESSION_2_COMPLETED", updatedAt: daysAgo(10) }), NOW);
    expect(info.stage).toBe("SESSION_2_COMPLETED");
    expect(info.flagged).toBe(false);
  });

  it("SESSION_2_COMPLETED with both feedback forms in → Feedback — Parent (parent wins)", () => {
    const info = computeStageInfo(
      student({
        workflowStatus: "SESSION_2_COMPLETED",
        formSubmissions: [form("FEEDBACK_STUDENT", daysAgo(5)), form("FEEDBACK_PARENT", daysAgo(2))],
      }),
      NOW
    );
    expect(info.stage).toBe("FEEDBACK_PARENT");
    expect(info.ageDays).toBe(2);
  });
});

describe("reportStageLabel — display fold for the frontend stage report", () => {
  it("passes through stages that already have a dedicated report row", () => {
    expect(reportStageLabel("INVITED")).toBe("Invited");
    expect(reportStageLabel("PRE_COUNSELLING_STUDENT")).toBe("Pre-Counselling — Student");
  });

  it("folds the 3 stages with no dedicated report row onto a neighbor's label", () => {
    expect(reportStageLabel("ASSESSMENT_PENDING")).toBe("Pre-Counselling — Parent");
    expect(reportStageLabel("COUNSELLOR_FEEDBACK")).toBe("Counsellor Feedback Report");
    expect(reportStageLabel("FEEDBACK_PENDING")).toBe("Session 2 Completed");
  });

  it("gives CLOSED its own row instead of folding onto Feedback — Parent", () => {
    expect(reportStageLabel("CLOSED")).toBe("Report Downloaded");
  });
});
