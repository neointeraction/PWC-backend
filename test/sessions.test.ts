import argon2 from "argon2";
import request from "supertest";
import { authRequest, bearer } from "./helpers/http.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { formatDisplayDate } from "../src/common/utils/dateFormat.js";

// Capture outgoing template emails instead of hitting the console provider, so tests can
// assert who was (and wasn't) emailed. Only sendTemplateEmail is replaced.
const { sendTemplateEmailMock } = vi.hoisted(() => ({ sendTemplateEmailMock: vi.fn() }));
vi.mock("../src/modules/email/email.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/email/email.service.js")>()),
  sendTemplateEmail: sendTemplateEmailMock,
}));

// Reset before every test so a rejection set in one test can't leak into the next.
beforeEach(() => {
  sendTemplateEmailMock.mockReset();
  sendTemplateEmailMock.mockResolvedValue({});
});

const app = createApp();

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}
// Session startTime/endTime ("HH:mm") are IST wall-clock (see combineDateTime in
// sessions.service.ts), not UTC — format in IST so "N minutes from now" fixtures land
// where the service expects them.
const istTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function hm(date: Date): string {
  return istTimeFormatter.format(date);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

let projectId: string;
let counsellorAId: string;
let counsellorBId: string;
let studentId: string;

async function cleanupProjectTree(namePrefix: string): Promise<void> {
  const projects = await prisma.project.findMany({ where: { name: { startsWith: namePrefix } } });
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return;
  const students = await prisma.student.findMany({ where: { projectId: { in: projectIds } } });
  const counsellors = await prisma.counsellor.findMany({
    where: { projects: { some: { projectId: { in: projectIds } } } },
  });
  const userIds = [...students.map((s) => s.userId), ...counsellors.map((c) => c.userId)];

  await prisma.session.deleteMany({ where: { studentId: { in: students.map((s) => s.id) } } });
  await prisma.counsellorSlot.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectCounsellor.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.student.deleteMany({ where: { id: { in: students.map((s) => s.id) } } });
  await prisma.counsellor.deleteMany({ where: { id: { in: counsellors.map((c) => c.id) } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// Anchor "now" to a fixed minute boundary so slot start/end times stay predictable.
const now = new Date();
now.setUTCSeconds(0, 0);

// Session 1's real booking must clear the 48-hour post-assessment-submission gate
// (MIN_SESSION1_GAP_HOURS in sessions.service.ts) — a near-"now" date 400s there, so this
// sits a few days out. Tests that need a near-"now" session (join window, no-show) get
// that time via a direct prisma write instead of the public booking endpoint — see
// `joinWindowStart`/`joinWindowEnd` below.
const session1Start = addDays(addMinutes(now, 5), 3);
const session1End = addMinutes(session1Start, 45);
const session1Date = session1Start;

const session2Date = addDays(session1Date, 3);
const session2Start = addDays(addMinutes(now, 5), 3);
const session2End = addMinutes(session2Start, 45);

// Near-"now" start/end for the T-10-minute join window test — applied directly via
// prisma.session.update after the real booking flow, since /book enforces the 48-hour gap
// this window intentionally violates.
const joinWindowStart = addMinutes(now, 5);
const joinWindowEnd = addMinutes(joinWindowStart, 45);

describe("Sessions API", () => {
  beforeAll(async () => {
    await cleanupProjectTree("Test Project Sessions");

    const project = await prisma.project.create({
      data: {
        code: "P-SESS",
        name: "Test Project Sessions",
        address: "1 Session St",
        contactNumber: "+919876570001",
        primaryEmail: "sessions@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;

    const passwordHash = await argon2.hash("temp-password");

    const counsellorAUser = await prisma.user.create({
      data: { email: "counsellor-a@test.example", passwordHash, role: "COUNSELLOR", firstName: "Asha", lastName: "Rao" },
    });
    const counsellorA = await prisma.counsellor.create({
      data: { userId: counsellorAUser.id, counsellorCode: "CN-SESS-A", mobile: "+919876570002" },
    });
    counsellorAId = counsellorA.id;

    const counsellorBUser = await prisma.user.create({
      data: { email: "counsellor-b@test.example", passwordHash, role: "COUNSELLOR", firstName: "Bala", lastName: "Iyer" },
    });
    const counsellorB = await prisma.counsellor.create({
      data: { userId: counsellorBUser.id, counsellorCode: "CN-SESS-B", mobile: "+919876570003" },
    });
    counsellorBId = counsellorB.id;

    await prisma.projectCounsellor.createMany({
      data: [
        { projectId, counsellorId: counsellorAId },
        { projectId, counsellorId: counsellorBId },
      ],
    });

    const studentUser = await prisma.user.create({
      data: { email: "student-sessions@test.example", passwordHash, role: "STUDENT", firstName: "Sam", lastName: "Kumar" },
    });
    const student = await prisma.student.create({
      data: {
        userId: studentUser.id,
        studentCode: "SESS-1",
        projectId,
        className: "Grade 9",
        divisionName: "A",
        mobile: "+919876570004",
        parentMobile: "+919876570005",
        parentEmail: "parent-sessions@test.example",
        fatherName: "Father",
        fatherOccupation: "Engineer",
        motherName: "Mother",
        motherOccupation: "Doctor",
        workflowStatus: "ASSESSMENT_COMPLETED",
      },
    });
    studentId = student.id;
  });

  afterAll(async () => {
    await cleanupProjectTree("Test Project Sessions");
    await prisma.$disconnect();
  });

  it("rejects booking before slots are imported", async () => {
    const res = await authRequest(app)
      .get(`/api/v1/sessions/students/${studentId}/booking-options`)
      .query({ sessionNumber: "SESSION_1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("imports the counsellor slot sheet once, then rejects a second import", async () => {
    const res = await authRequest(app)
      .post("/api/v1/sessions/slots/import")
      .send({
        projectId,
        slots: [
          { counsellorId: counsellorAId, date: ymd(session1Date), startTime: hm(session1Start), endTime: hm(session1End) },
          { counsellorId: counsellorAId, date: ymd(session2Date), startTime: hm(session2Start), endTime: hm(session2End) },
          { counsellorId: counsellorBId, date: ymd(session1Date), startTime: hm(session1Start), endTime: hm(session1End) },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(3);

    const second = await authRequest(app)
      .post("/api/v1/sessions/slots/import")
      .send({ projectId, slots: [{ counsellorId: counsellorAId, date: ymd(session1Date), startTime: "09:00", endTime: "09:30" }] });
    expect(second.status).toBe(409);
  });

  it("shows a blind, deduped Session 1 slot list", async () => {
    const res = await authRequest(app)
      .get(`/api/v1/sessions/students/${studentId}/booking-options`)
      .query({ sessionNumber: "SESSION_1" });
    expect(res.status).toBe(200);
    // 2 distinct (date, startTime, endTime) combos — counsellor A and B both offered
    // session1Date/startTime, so that pair is deduped down to one entry.
    expect(res.body).toHaveLength(2);
    const session1Option = res.body.find((s: { startTime: string }) => s.startTime === hm(session1Start));
    expect(session1Option).toBeDefined();
    // slotDate is now rendered in the generic display format ("01 Aug 2026"), not ISO.
    // en-GB short month is usually 3 letters (e.g. "Aug") but ICU renders September as
    // "Sept" (4 letters) — accept either so this doesn't flake depending on the month.
    expect(session1Option.slotDate).toMatch(/^\d{2} [A-Z][a-z]{2,3} \d{4}$/);
  });

  it("previews Session 2 options locked to Session 1's would-be counsellor", async () => {
    const res = await authRequest(app)
      .get(`/api/v1/sessions/students/${studentId}/booking-options`)
      .query({ sessionNumber: "SESSION_2", session1Date: ymd(session1Date), session1StartTime: hm(session1Start) });
    expect(res.status).toBe(200);
    // Counsellor A (first-available, upload order) has one other open slot: session2Date/session2Start.
    expect(res.body).toHaveLength(1);
    expect(res.body[0].startTime).toBe(hm(session2Start));
  });

  it("books both sessions atomically, locking Session 2 to Session 1's counsellor", async () => {
    const res = await authRequest(app)
      .post(`/api/v1/sessions/students/${studentId}/book`)
      .send({
        session1: { date: ymd(session1Date), startTime: hm(session1Start) },
        session2: { date: ymd(session2Date), startTime: hm(session2Start) },
      });
    expect(res.status).toBe(201);
    expect(res.body.session1.counsellor.id).toBe(res.body.session2.counsellor.id);
    expect(res.body.session1.sessionNumber).toBe("SESSION_1");
    expect(res.body.session2.sessionNumber).toBe("SESSION_2");
    // Counsellor mobile is nested directly on every session response — no separate
    // GET /counsellors?projectId cross-reference needed to show contact info.
    expect(res.body.session1.counsellor.mobile).toBe("+919876570002");

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    expect(student?.workflowStatus).toBe("SESSION_SCHEDULED");
  });

  it("rejects booking again for a student who already has sessions", async () => {
    const res = await authRequest(app)
      .post(`/api/v1/sessions/students/${studentId}/book`)
      .send({
        session1: { date: ymd(session1Date), startTime: hm(session1Start) },
        session2: { date: ymd(session2Date), startTime: hm(session2Start) },
      });
    expect(res.status).toBe(409);
  });

  it("lists the student's two session cards", async () => {
    const res = await authRequest(app).get(`/api/v1/sessions/students/${studentId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("rejects joining before the T-10-minute window opens", async () => {
    // A separate admin-created session at `farFuture`, well outside the join window.
    const passwordHash = await argon2.hash("temp-password");
    const otherUser = await prisma.user.create({
      data: { email: "student-sessions-2@test.example", passwordHash, role: "STUDENT", firstName: "Priya", lastName: "Nair" },
    });
    const otherStudent = await prisma.student.create({
      data: {
        userId: otherUser.id,
        studentCode: "SESS-2",
        projectId,
        className: "Grade 9",
        divisionName: "A",
        mobile: "+919876570006",
        parentMobile: "+919876570007",
        parentEmail: "parent-sessions-2@test.example",
        fatherName: "Father",
        fatherOccupation: "Engineer",
        motherName: "Mother",
        motherOccupation: "Doctor",
        workflowStatus: "ASSESSMENT_COMPLETED",
      },
    });

    const farFuture = addMinutes(now, 120);
    const create = await authRequest(app).post("/api/v1/sessions").send({
      studentId: otherStudent.id,
      counsellorId: counsellorAId,
      sessionNumber: "SESSION_1",
      date: ymd(farFuture),
      startTime: hm(farFuture),
      endTime: hm(addMinutes(farFuture, 45)),
    });
    expect(create.status).toBe(201);

    const res = await authRequest(app).post(`/api/v1/sessions/${create.body.id}/join`).send({ role: "STUDENT" });
    expect(res.status).toBe(400);
  });

  it("resolves the meeting link from the assigned counsellor, and allows join once inside the window", async () => {
    const list = await authRequest(app).get(`/api/v1/sessions/students/${studentId}`);
    const session1 = list.body.find((s: { sessionNumber: string }) => s.sessionNumber === "SESSION_1");
    expect(session1.counsellor.id).toBe(counsellorAId);

    // No per-session link to set — the counsellor's own meetingLink is what /join returns.
    const linkRes = await authRequest(app)
      .patch(`/api/v1/counsellors/${counsellorAId}`)
      .send({ meetingLink: "https://meet.example.com/abc" });
    expect(linkRes.status).toBe(200);

    // session1 was booked days out (to clear the 48-hour post-assessment gate) — move it
    // directly via prisma, bypassing /reschedule, to land inside the T-10min join window.
    await prisma.session.update({
      where: { id: session1.id },
      data: { scheduledDate: now, startTime: hm(joinWindowStart), endTime: hm(joinWindowEnd) },
    });

    const joinRes = await authRequest(app).post(`/api/v1/sessions/${session1.id}/join`).send({ role: "STUDENT" });
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.meetingLink).toBe("https://meet.example.com/abc");
    expect(joinRes.body.session.counsellor.meetingLink).toBe("https://meet.example.com/abc");
    expect(joinRes.body.session.studentJoinedAt).not.toBeNull();
  });

  it("adds counsellor notes independent of the join flow", async () => {
    const list = await authRequest(app).get(`/api/v1/sessions/students/${studentId}`);
    const session1 = list.body.find((s: { sessionNumber: string }) => s.sessionNumber === "SESSION_1");

    const res = await authRequest(app).patch(`/api/v1/sessions/${session1.id}/notes`).send({ notes: "Strong interest in design." });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe("Strong interest in design.");
  });

  it("completes Session 1 and advances the workflow status", async () => {
    const list = await authRequest(app).get(`/api/v1/sessions/students/${studentId}`);
    const session1 = list.body.find((s: { sessionNumber: string }) => s.sessionNumber === "SESSION_1");

    const res = await authRequest(app).post(`/api/v1/sessions/${session1.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    expect(student?.workflowStatus).toBe("SESSION_1_COMPLETED");
  });

  it("cancels Session 2 and releases its slot back to OPEN", async () => {
    const list = await authRequest(app).get(`/api/v1/sessions/students/${studentId}`);
    const session2 = list.body.find((s: { sessionNumber: string }) => s.sessionNumber === "SESSION_2");

    const res = await authRequest(app)
      .post(`/api/v1/sessions/${session2.id}/cancel`)
      .send({ reason: "STUDENT_UNAVAILABLE", notes: "Clashing exam", initiatedBy: "STUDENT" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");

    const slot = await prisma.counsellorSlot.findFirst({
      where: { counsellorId: res.body.counsellor.id, slotDate: session2Date, startTime: hm(session2Start) },
    });
    expect(slot?.status).toBe("OPEN");
    expect(slot?.sessionId).toBeNull();
  });

  describe("My Students", () => {
    it("lists every student across the counsellor's assigned projects, not just students with a booked session", async () => {
      // counsellorB has no Session with `studentId` (only counsellorA does, from the
      // booking test above) but is assigned to the same project, so should still see them.
      const res = await authRequest(app).get(`/api/v1/sessions/counsellors/${counsellorBId}/my-students`);
      expect(res.status).toBe(200);
      const entry = res.body.find((s: { id: string }) => s.id === studentId);
      expect(entry).toBeDefined();
      expect(entry.studentCode).toBe("SESS-1");
      expect(entry.class).toBe("Grade 9");
      expect(entry.division).toBe("A");
      expect(entry.totalForms).toBe(4);
      expect(entry.formsSubmitted).toBe(0);
      expect(entry.assessmentSubmitted).toBe(false); // workflowStatus was set directly in test setup, no real AssessmentAttempt row
      expect(entry.sessions).toEqual([]); // no Session exists between this student and counsellorB
    });

    it("shows the counsellor's own sessions with a student they're actually assigned to", async () => {
      const res = await authRequest(app).get(`/api/v1/sessions/counsellors/${counsellorAId}/my-students`);
      expect(res.status).toBe(200);
      const entry = res.body.find((s: { id: string }) => s.id === studentId);
      expect(entry.sessions).toHaveLength(2);
      expect(entry.sessions.map((s: { sessionNumber: string }) => s.sessionNumber)).toEqual(["SESSION_1", "SESSION_2"]);
    });

    it("filters by workflowStatus", async () => {
      const res = await authRequest(app)
        .get(`/api/v1/sessions/counsellors/${counsellorAId}/my-students`)
        .query({ workflowStatus: "DRAFT" });
      expect(res.status).toBe(200);
      expect(res.body.find((s: { id: string }) => s.id === studentId)).toBeUndefined();
    });

    it("rejects a projectId the counsellor isn't assigned to", async () => {
      const otherProject = await prisma.project.create({
        data: { code: "P-SESS-UNASSIGNED", name: "Test Project Sessions Unassigned", address: "", contactNumber: "+919876570099", primaryEmail: "sessions-unassigned@test-project.example", fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31") },
      });
      const res = await authRequest(app)
        .get(`/api/v1/sessions/counsellors/${counsellorAId}/my-students`)
        .query({ projectId: otherProject.id });
      expect(res.status).toBe(400);
      await prisma.project.delete({ where: { id: otherProject.id } });
    });

    it("404s for an unknown counsellor", async () => {
      const res = await authRequest(app).get(`/api/v1/sessions/counsellors/cnonexistent00000000000000/my-students`);
      expect(res.status).toBe(404);
    });
  });

  describe("Rebooking after cancellation", () => {
    // Session 2 for `studentId` was cancelled in the "cancels Session 2" test above —
    // reuse that state rather than re-deriving it.
    it("reschedule reactivates a CANCELLED session, keeping it locked to the same counsellor", async () => {
      const cancelled = await prisma.session.findFirst({ where: { studentId, sessionNumber: "SESSION_2" } });
      expect(cancelled?.status).toBe("CANCELLED");

      const newDate = addDays(session2Date, 10);
      await prisma.counsellorSlot.create({
        data: { counsellorId: counsellorAId, projectId, slotDate: newDate, startTime: hm(session2Start), endTime: hm(session2End) },
      });

      const res = await authRequest(app)
        .post(`/api/v1/sessions/${cancelled!.id}/reschedule`)
        .send({ date: ymd(newDate), startTime: hm(session2Start), initiatedBy: "ADMIN" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SCHEDULED");
      expect(res.body.cancellationReason).toBeNull();
      expect(res.body.counsellor.id).toBe(counsellorAId); // still the locked-in counsellor

      // Only ever one row for (studentId, SESSION_2) — reactivated in place, not a new row.
      const rows = await prisma.session.findMany({ where: { studentId, sessionNumber: "SESSION_2" } });
      expect(rows).toHaveLength(1);
    });

    it("createSessionManually reactivates a CANCELLED session in place, even with a different counsellor", async () => {
      const active = await prisma.session.findFirst({ where: { studentId, sessionNumber: "SESSION_2" } });
      const cancelRes = await authRequest(app)
        .post(`/api/v1/sessions/${active!.id}/cancel`)
        .send({ reason: "COUNSELLOR_UNAVAILABLE", initiatedBy: "ADMIN" });
      expect(cancelRes.status).toBe(200);

      // A completely fresh assignment to counsellor B (bypasses slot inventory, like any admin manual create).
      const farFuture = addDays(session2Date, 20);
      const res = await authRequest(app).post("/api/v1/sessions").send({
        studentId,
        counsellorId: counsellorBId,
        sessionNumber: "SESSION_2",
        date: ymd(farFuture),
        startTime: "11:00",
        endTime: "11:30",
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("SCHEDULED");
      expect(res.body.counsellor.id).toBe(counsellorBId);

      const rows = await prisma.session.findMany({ where: { studentId, sessionNumber: "SESSION_2" } });
      expect(rows).toHaveLength(1);
    });

    it("still rejects creating over an active (non-cancelled) session", async () => {
      const res = await authRequest(app).post("/api/v1/sessions").send({
        studentId,
        counsellorId: counsellorAId,
        sessionNumber: "SESSION_2",
        date: ymd(addDays(session2Date, 30)),
        startTime: "12:00",
        endTime: "12:30",
      });
      expect(res.status).toBe(409);
    });
  });

  describe("Reschedule limit, counsellor-initiated reschedule, and restart", () => {
    let fixtureCounter = 0;

    // Books a real Session 1 + Session 2 pair (via the real booking flow, so a real
    // CounsellorSlot inventory backs it) for a brand-new student, locked to counsellorA.
    // Also adds one spare "alternative" open slot on counsellorA (for reschedule
    // targets) and one on counsellorB (to prove cross-counsellor proposals are rejected).
    async function bookFreshPairForNewStudent() {
      fixtureCounter += 1;
      const passwordHash = await argon2.hash("temp-password");
      const user = await prisma.user.create({
        data: { email: `resched-student-${fixtureCounter}@test.example`, passwordHash, role: "STUDENT", firstName: "Resh", lastName: "Kapoor" },
      });
      const student = await prisma.student.create({
        data: {
          userId: user.id,
          studentCode: `SESS-RESCHED-${fixtureCounter}`,
          projectId,
          className: "Grade 9",
        divisionName: "A",
          mobile: `+91987659${(1000 + fixtureCounter).toString().padStart(4, "0")}`,
          parentMobile: `+91987660${(1000 + fixtureCounter).toString().padStart(4, "0")}`,
          parentEmail: `parent-resched-${fixtureCounter}@test.example`,
          fatherName: "Father",
          fatherOccupation: "Engineer",
          motherName: "Mother",
          motherOccupation: "Doctor",
          workflowStatus: "ASSESSMENT_COMPLETED",
        },
      });

      // Far-future dates, widely offset per fixture — some tests add their own extra
      // slots further out from `base` (e.g. altDate + 20 days), so fixtures need a lot
      // of headroom between them to never collide on (counsellorId, date, startTime).
      const base = addDays(now, 100 + fixtureCounter * 200);
      const s1Date = base;
      const altDate = addDays(base, 10); // spare slot for Session 1 reschedule targets
      // Session 1 must stay chronologically before Session 2 (assertSessionGap is
      // direction-aware, not just a >=2-day gap) — s2Date needs enough headroom past
      // every Session-1 reschedule target below (altDate, and altDate+20 further down).
      const s2Date = addDays(base, 40);
      const time = "11:00";
      const endTime = "11:45";

      await authRequest(app).post("/api/v1/sessions/slots").send({
        projectId,
        counsellorId: counsellorAId,
        slots: [
          { date: ymd(s1Date), startTime: time, endTime },
          { date: ymd(s2Date), startTime: time, endTime },
          { date: ymd(altDate), startTime: time, endTime },
        ],
      });
      await authRequest(app).post("/api/v1/sessions/slots").send({
        projectId,
        counsellorId: counsellorBId,
        slots: [{ date: ymd(altDate), startTime: time, endTime }],
      });

      const booked = await authRequest(app)
        .post(`/api/v1/sessions/students/${student.id}/book`)
        .send({ session1: { date: ymd(s1Date), startTime: time }, session2: { date: ymd(s2Date), startTime: time } });
      expect(booked.status).toBe(201);

      return {
        studentId: student.id,
        session1Id: booked.body.session1.id as string,
        session2Id: booked.body.session2.id as string,
        altDate,
        time,
      };
    }

    it("locks the Session 1 booking-options preview to the existing session's counsellor when rescheduling", async () => {
      const { studentId: freshStudentId, session1Id, altDate, time } = await bookFreshPairForNewStudent();

      // A distinct, unambiguous counsellorB-only slot that a blind query would include
      // but the counsellor-locked preview must not.
      const counsellorBOnlyDate = addDays(altDate, 1);
      await authRequest(app).post("/api/v1/sessions/slots").send({
        projectId,
        counsellorId: counsellorBId,
        slots: [{ date: ymd(counsellorBOnlyDate), startTime: time, endTime: "11:45" }],
      });

      const res = await authRequest(app)
        .get(`/api/v1/sessions/students/${freshStudentId}/booking-options`)
        .query({ sessionNumber: "SESSION_1", rescheduleSessionId: session1Id });
      expect(res.status).toBe(200);

      const match = res.body.find(
        (s: { startTime: string; slotDate: string }) => s.startTime === time && s.slotDate === formatDisplayDate(altDate)
      );
      expect(match).toBeDefined();

      const leaked = res.body.find(
        (s: { startTime: string; slotDate: string }) => s.startTime === time && s.slotDate === formatDisplayDate(counsellorBOnlyDate)
      );
      expect(leaked).toBeUndefined();

      // The slot it points to actually works on submit — no 409 from a counsellor mismatch.
      const reschedule = await authRequest(app)
        .post(`/api/v1/sessions/${session1Id}/reschedule`)
        .send({ date: ymd(altDate), startTime: time, initiatedBy: "STUDENT" });
      expect(reschedule.status).toBe(200);
    });

    it("lets a student discover and rebook Session 2 solo after cancelling it, locked to the same counsellor", async () => {
      const { studentId: freshStudentId, session2Id, altDate, time } = await bookFreshPairForNewStudent();

      const cancelled = await authRequest(app)
        .post(`/api/v1/sessions/${session2Id}/cancel`)
        .send({ initiatedBy: "STUDENT", reason: "STUDENT_UNAVAILABLE" });
      expect(cancelled.status).toBe(200);

      // Session 1's date/time is now BOOKED, not OPEN — the session1Date/session1StartTime
      // discovery form can't resolve a counsellor from it. rescheduleSessionId is the only
      // way in for a solo Session 2 rebook.
      const blindForm = await authRequest(app)
        .get(`/api/v1/sessions/students/${freshStudentId}/booking-options`)
        .query({ sessionNumber: "SESSION_2" });
      expect(blindForm.status).toBe(400);

      const preview = await authRequest(app)
        .get(`/api/v1/sessions/students/${freshStudentId}/booking-options`)
        .query({ sessionNumber: "SESSION_2", rescheduleSessionId: session2Id });
      expect(preview.status).toBe(200);
      const match = preview.body.find(
        (s: { startTime: string; slotDate: string }) => s.startTime === time && s.slotDate === formatDisplayDate(altDate)
      );
      expect(match).toBeDefined();

      const rebook = await authRequest(app)
        .post(`/api/v1/sessions/${session2Id}/reschedule`)
        .send({ date: ymd(altDate), startTime: time, initiatedBy: "STUDENT" });
      expect(rebook.status).toBe(200);
      expect(rebook.body.status).toBe("SCHEDULED");
      expect(rebook.body.counsellor.id).toBe(counsellorAId);
      // Reactivating a cancelled session is a fresh start — it must not burn the
      // student's one-time SCHEDULED-session reschedule allowance.
      expect(rebook.body.studentRescheduleUsed).toBe(false);
    });

    it("404s the Session 2 rebook preview for a session that isn't this student's SESSION_2, and 400s if Session 1 isn't booked", async () => {
      const a = await bookFreshPairForNewStudent();
      const b = await bookFreshPairForNewStudent();

      const wrongStudent = await authRequest(app)
        .get(`/api/v1/sessions/students/${b.studentId}/booking-options`)
        .query({ sessionNumber: "SESSION_2", rescheduleSessionId: a.session2Id });
      expect(wrongStudent.status).toBe(404);

      const wrongSessionNumber = await authRequest(app)
        .get(`/api/v1/sessions/students/${a.studentId}/booking-options`)
        .query({ sessionNumber: "SESSION_2", rescheduleSessionId: a.session1Id });
      expect(wrongSessionNumber.status).toBe(404);

      // Cancel both of a's sessions (Option B) so Session 1 is no longer active, then
      // reuse the now-cancelled Session 2 id — there's no active Session 1 to anchor the
      // ≥2-day gap against.
      const restart = await authRequest(app).post(`/api/v1/sessions/students/${a.studentId}/restart`).send({});
      expect(restart.status).toBe(200);
      const noSession1 = await authRequest(app)
        .get(`/api/v1/sessions/students/${a.studentId}/booking-options`)
        .query({ sessionNumber: "SESSION_2", rescheduleSessionId: a.session2Id });
      expect(noSession1.status).toBe(400);
    });

    it("404s the Session 1 reschedule preview for a session that isn't this student's SESSION_1", async () => {
      const a = await bookFreshPairForNewStudent();
      const b = await bookFreshPairForNewStudent();

      const wrongStudent = await authRequest(app)
        .get(`/api/v1/sessions/students/${b.studentId}/booking-options`)
        .query({ sessionNumber: "SESSION_1", rescheduleSessionId: a.session1Id });
      expect(wrongStudent.status).toBe(404);

      const wrongSessionNumber = await authRequest(app)
        .get(`/api/v1/sessions/students/${a.studentId}/booking-options`)
        .query({ sessionNumber: "SESSION_1", rescheduleSessionId: a.session2Id });
      expect(wrongSessionNumber.status).toBe(404);
    });

    it("blocks a second STUDENT-initiated reschedule, but not an ADMIN one", async () => {
      const { session1Id, altDate, time } = await bookFreshPairForNewStudent();
      const nextAlt = addDays(altDate, 20);
      await authRequest(app).post("/api/v1/sessions/slots").send({
        projectId,
        counsellorId: counsellorAId,
        slots: [{ date: ymd(nextAlt), startTime: time, endTime: "11:45" }],
      });

      const first = await authRequest(app)
        .post(`/api/v1/sessions/${session1Id}/reschedule`)
        .send({ date: ymd(altDate), startTime: time, initiatedBy: "STUDENT" });
      expect(first.status).toBe(200);
      expect(first.body.studentRescheduleUsed).toBe(true);

      const second = await authRequest(app)
        .post(`/api/v1/sessions/${session1Id}/reschedule`)
        .send({ date: ymd(nextAlt), startTime: time, initiatedBy: "STUDENT" });
      expect(second.status).toBe(400);

      // Admin isn't limited by the same flag.
      const asAdmin = await authRequest(app)
        .post(`/api/v1/sessions/${session1Id}/reschedule`)
        .send({ date: ymd(nextAlt), startTime: time, initiatedBy: "ADMIN" });
      expect(asAdmin.status).toBe(200);
    });

    it("blocks a reschedule that would invert Session 1 / Session 2 chronological order", async () => {
      const { session1Id, session2Id } = await bookFreshPairForNewStudent();
      const session2Before = await prisma.session.findUniqueOrThrow({ where: { id: session2Id } });
      const afterSession2 = addDays(session2Before.scheduledDate, 10);
      const time = "09:00";
      await authRequest(app).post("/api/v1/sessions/slots").send({
        projectId,
        counsellorId: counsellorAId,
        slots: [{ date: ymd(afterSession2), startTime: time, endTime: "09:45" }],
      });

      // Moving Session 1 to a date past Session 2 satisfies the >=2-day gap in
      // isolation but would invert the two sessions' chronological order.
      const res = await authRequest(app)
        .post(`/api/v1/sessions/${session1Id}/reschedule`)
        .send({ date: ymd(afterSession2), startTime: time, initiatedBy: "ADMIN" });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Session 1 must stay .* before Session 2/);

      const session1After = await prisma.session.findUniqueOrThrow({ where: { id: session1Id } });
      expect(ymd(session1After.scheduledDate)).not.toBe(ymd(afterSession2)); // rejected, not applied
    });

    it("restarts (Option B): cancels both sessions, then rebooking reactivates them fresh", async () => {
      const { studentId: freshStudentId, session1Id, session2Id } = await bookFreshPairForNewStudent();

      const restarted = await authRequest(app).post(`/api/v1/sessions/students/${freshStudentId}/restart`);
      expect(restarted.status).toBe(200);
      expect(restarted.body.cancelled).toHaveLength(2);
      expect(restarted.body.cancelled.every((s: { status: string }) => s.status === "CANCELLED")).toBe(true);

      // Both slots released.
      const s1 = await prisma.session.findUnique({ where: { id: session1Id } });
      const s2 = await prisma.session.findUnique({ where: { id: session2Id } });
      expect(s1?.status).toBe("CANCELLED");
      expect(s2?.status).toBe("CANCELLED");

      // Fresh booking against new dates reactivates the same two rows (same ids), not new ones.
      const newBase = addDays(now, 5000 + fixtureCounter * 200);
      const newS1 = newBase;
      const newS2 = addDays(newBase, 3);
      await authRequest(app).post("/api/v1/sessions/slots").send({
        projectId,
        counsellorId: counsellorBId,
        slots: [
          { date: ymd(newS1), startTime: "09:00", endTime: "09:45" },
          { date: ymd(newS2), startTime: "09:00", endTime: "09:45" },
        ],
      });
      const rebooked = await authRequest(app)
        .post(`/api/v1/sessions/students/${freshStudentId}/book`)
        .send({ session1: { date: ymd(newS1), startTime: "09:00" }, session2: { date: ymd(newS2), startTime: "09:00" } });
      expect(rebooked.status).toBe(201);
      expect(rebooked.body.session1.id).toBe(session1Id); // reactivated in place
      expect(rebooked.body.session2.id).toBe(session2Id);
      expect(rebooked.body.session1.status).toBe("SCHEDULED");
      expect(rebooked.body.counsellor.id).toBe(counsellorBId); // fresh blind assignment, not locked to A
    });

    it("409s restarting once Session 1 has already been joined", async () => {
      const { studentId: freshStudentId, session1Id } = await bookFreshPairForNewStudent();
      await prisma.session.update({ where: { id: session1Id }, data: { studentJoinedAt: new Date() } });

      const res = await authRequest(app).post(`/api/v1/sessions/students/${freshStudentId}/restart`);
      expect(res.status).toBe(409);
    });

    it("detaches after Session 1 is completed: cancels both, frees slots, rolls the student back to booking", async () => {
      const { studentId: fresh, session1Id, session2Id } = await bookFreshPairForNewStudent();
      await prisma.session.update({ where: { id: session1Id }, data: { notes: "old counsellor notes" } });
      const done = await authRequest(app).post(`/api/v1/sessions/${session1Id}/complete`);
      expect(done.status).toBe(200);
      expect((await prisma.student.findUnique({ where: { id: fresh } }))?.workflowStatus).toBe("SESSION_1_COMPLETED");

      // The student-facing restart refuses once Session 1 is done; the admin detach doesn't.
      expect((await authRequest(app).post(`/api/v1/sessions/students/${fresh}/restart`)).status).toBe(409);

      const res = await authRequest(app).post(`/api/v1/sessions/students/${fresh}/detach`);
      expect(res.status).toBe(200);
      expect(res.body.cancelled).toHaveLength(2);
      expect(res.body.cancelled.every((s: { status: string }) => s.status === "CANCELLED")).toBe(true);

      const slots = await prisma.counsellorSlot.findMany({ where: { sessionId: { in: [session1Id, session2Id] } } });
      expect(slots).toHaveLength(0); // both released back to OPEN, unlinked
      expect((await prisma.student.findUnique({ where: { id: fresh } }))?.workflowStatus).toBe("ASSESSMENT_COMPLETED");

      // Nothing left to detach.
      expect((await authRequest(app).post(`/api/v1/sessions/students/${fresh}/detach`)).status).toBe(409);
    });

    it("409s joining or completing Session 2 while Session 1 isn't completed", async () => {
      const { session2Id } = await bookFreshPairForNewStudent();
      const join = await authRequest(app).post(`/api/v1/sessions/${session2Id}/join`).send({ role: "COUNSELLOR" });
      expect(join.status).toBe(409);
      expect(join.body.error.message).toMatch(/Session 1 must be completed/);
      const complete = await authRequest(app).post(`/api/v1/sessions/${session2Id}/complete`);
      expect(complete.status).toBe(409);
      expect((await prisma.session.findUnique({ where: { id: session2Id } }))?.status).toBe("SCHEDULED");
    });

    it("409s detaching once the student has moved past the sessions (feedback stage)", async () => {
      const { studentId: fresh } = await bookFreshPairForNewStudent();
      await prisma.student.update({ where: { id: fresh }, data: { workflowStatus: "COUNSELLOR_FEEDBACK" } });
      expect((await authRequest(app).post(`/api/v1/sessions/students/${fresh}/detach`)).status).toBe(409);
      // Sessions untouched.
      expect(await prisma.session.count({ where: { studentId: fresh, status: "CANCELLED" } })).toBe(0);
    });

    it("still detaches between the sessions (report stage, Session 1 done)", async () => {
      const { studentId: fresh } = await bookFreshPairForNewStudent();
      await prisma.student.update({ where: { id: fresh }, data: { workflowStatus: "COUNSELLOR_FEEDBACK_REPORT" } });
      expect((await authRequest(app).post(`/api/v1/sessions/students/${fresh}/detach`)).status).toBe(200);
    });

    it("409s detaching once Session 2 is completed", async () => {
      const { studentId: fresh, session2Id } = await bookFreshPairForNewStudent();
      await prisma.session.update({ where: { id: session2Id }, data: { status: "COMPLETED" } });
      expect((await authRequest(app).post(`/api/v1/sessions/students/${fresh}/detach`)).status).toBe(409);
    });
  });

  describe("No-show tracking", () => {
    let noShowFixtureCounter = 0;

    // @@unique([studentId, sessionNumber]) allows only one row per session number per
    // student ever (even cancelled ones stay in place) — each fixture needs its own
    // student so tests can freely reuse SESSION_1/SESSION_2 without colliding.
    async function createInProgressSessionForNewStudent(sessionNumber: "SESSION_1" | "SESSION_2", counsellorId: string) {
      noShowFixtureCounter += 1;
      const passwordHash = await argon2.hash("temp-password");
      const user = await prisma.user.create({
        data: {
          email: `noshow-student-${noShowFixtureCounter}@test.example`,
          passwordHash,
          role: "STUDENT",
          firstName: "Nia",
          lastName: "Shah",
        },
      });
      const student = await prisma.student.create({
        data: {
          userId: user.id,
          studentCode: `SESS-NOSHOW-${noShowFixtureCounter}`,
          projectId,
          className: "Grade 9",
        divisionName: "A",
          mobile: `+91987657${(1000 + noShowFixtureCounter).toString().padStart(4, "0")}`,
          parentMobile: `+91987658${(1000 + noShowFixtureCounter).toString().padStart(4, "0")}`,
          parentEmail: `parent-noshow-${noShowFixtureCounter}@test.example`,
          fatherName: "Father",
          fatherOccupation: "Engineer",
          motherName: "Mother",
          motherOccupation: "Doctor",
          workflowStatus: "ASSESSMENT_COMPLETED",
        },
      });
      // "In progress" — started a few minutes ago, doesn't end for a while yet. Satisfies
      // the no-show endpoint's "at or after startTime" gate without also crossing
      // endTime, which would trigger the separate passive reconcileNoShow() (both flags
      // auto-true once a SCHEDULED session's endTime has passed unattended) and make
      // this fixture indistinguishable from that mechanism. Offset varies per fixture —
      // @@unique([counsellorId, scheduledDate, startTime]) would otherwise collide when
      // the same counsellor is reused across fixtures.
      const startTime = hm(addMinutes(now, -10 - noShowFixtureCounter));
      const endTime = hm(addMinutes(now, 60 + noShowFixtureCounter));
      const session = await prisma.session.create({
        data: {
          studentId: student.id,
          counsellorId,
          sessionNumber,
          scheduledDate: now,
          startTime,
          endTime,
        },
      });
      return { studentId: student.id, session };
    }

    it("rejects marking no-show before the session's scheduled start time", async () => {
      const { session: inProgress } = await createInProgressSessionForNewStudent("SESSION_1", counsellorAId);
      // Move this one fixture's session into the future instead of already-started.
      const future = await prisma.session.update({
        where: { id: inProgress.id },
        data: { scheduledDate: addDays(now, 5), startTime: "10:00", endTime: "10:45" },
      });
      const res = await authRequest(app).post(`/api/v1/sessions/${future.id}/no-show`).send({ party: "STUDENT" });
      expect(res.status).toBe(400);
    });

    it("marks a student no-show and is idempotent on repeat calls", async () => {
      const { session } = await createInProgressSessionForNewStudent("SESSION_1", counsellorAId);

      const res = await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show`).send({ party: "STUDENT" });
      expect(res.status).toBe(200);
      expect(res.body.studentNoShow).toBe(true);
      expect(res.body.counsellorNoShow).toBe(false);
      expect(res.body.status).toBe("SCHEDULED"); // marking no-show doesn't cancel the session

      const again = await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show`).send({ party: "STUDENT" });
      expect(again.status).toBe(200);
      expect(again.body.studentNoShow).toBe(true);
    });

    it("marks a counsellor no-show", async () => {
      const { session } = await createInProgressSessionForNewStudent("SESSION_2", counsellorAId);

      const res = await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show`).send({ party: "COUNSELLOR" });
      expect(res.status).toBe(200);
      expect(res.body.counsellorNoShow).toBe(true);
      expect(res.body.studentNoShow).toBe(false);
    });

    it("409s marking no-show on a session that isn't SCHEDULED", async () => {
      const { session } = await createInProgressSessionForNewStudent("SESSION_1", counsellorBId);
      await authRequest(app)
        .post(`/api/v1/sessions/${session.id}/cancel`)
        .send({ reason: "OTHER", initiatedBy: "ADMIN" });

      const res = await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show`).send({ party: "STUDENT" });
      expect(res.status).toBe(409);
    });

    it("gates the reschedule-prompt on studentNoShow, and to Admin only", async () => {
      const { session } = await createInProgressSessionForNewStudent("SESSION_2", counsellorBId);

      // Not yet flagged.
      const tooSoon = await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show/reschedule-prompt`);
      expect(tooSoon.status).toBe(400);

      await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show`).send({ party: "STUDENT" });

      const asCounsellor = await request(app)
        .post(`/api/v1/sessions/${session.id}/no-show/reschedule-prompt`)
        .set("Authorization", bearer("COUNSELLOR"));
      expect(asCounsellor.status).toBe(403);

      const res = await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show/reschedule-prompt`);
      expect(res.status).toBe(202);
    });

    it("filters the oversight list by noShow", async () => {
      const { studentId: fixtureStudentId, session } = await createInProgressSessionForNewStudent("SESSION_1", counsellorAId);
      await authRequest(app).post(`/api/v1/sessions/${session.id}/no-show`).send({ party: "STUDENT" });

      const res = await authRequest(app).get("/api/v1/sessions").query({ studentId: fixtureStudentId, noShow: "STUDENT" });
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((s: { studentNoShow: boolean }) => s.studentNoShow)).toBe(true);
    });
  });

  describe("Slot release on student deletion", () => {
    it("releases the CounsellorSlot back to OPEN when a student with a booked session is deleted", async () => {
      const passwordHash = await argon2.hash("temp-password");
      const orphanUser = await prisma.user.create({
        data: { email: "student-orphan-check@test.example", passwordHash, role: "STUDENT", firstName: "Orphan", lastName: "Check" },
      });
      const orphanStudent = await prisma.student.create({
        data: {
          userId: orphanUser.id,
          studentCode: "SESS-ORPHAN",
          projectId,
          className: "Grade 9",
        divisionName: "A",
          mobile: "+919876570008",
          parentMobile: "+919876570009",
          parentEmail: "parent-orphan@test.example",
          fatherName: "Father",
          fatherOccupation: "Engineer",
          motherName: "Mother",
          motherOccupation: "Doctor",
        },
      });

      const slotDate = addDays(session2Date, 40);
      const slot = await prisma.counsellorSlot.create({
        data: { counsellorId: counsellorAId, projectId, slotDate, startTime: "09:00", endTime: "09:30" },
      });
      const orphanSession = await prisma.session.create({
        data: {
          studentId: orphanStudent.id,
          counsellorId: counsellorAId,
          sessionNumber: "SESSION_1",
          scheduledDate: slotDate,
          startTime: "09:00",
          endTime: "09:30",
        },
      });
      await prisma.counsellorSlot.update({ where: { id: slot.id }, data: { status: "BOOKED", sessionId: orphanSession.id } });

      const del = await authRequest(app).delete(`/api/v1/students/${orphanStudent.id}`);
      expect(del.status).toBe(204);

      const afterDelete = await prisma.counsellorSlot.findUnique({ where: { id: slot.id } });
      expect(afterDelete?.status).toBe("OPEN");
      expect(afterDelete?.sessionId).toBeNull();
    });
  });

  describe("Admin manual creation — confirmation emails", () => {
    let fixtureCounter = 0;

    async function createStudent(parentEmail: string | null) {
      fixtureCounter += 1;
      const passwordHash = await argon2.hash("temp-password");
      const user = await prisma.user.create({
        data: { email: `manual-student-${fixtureCounter}@test.example`, passwordHash, role: "STUDENT", firstName: "Manu", lastName: "Al" },
      });
      const student = await prisma.student.create({
        data: {
          userId: user.id,
          studentCode: `SESS-MANUAL-${fixtureCounter}`,
          projectId,
          className: "Grade 9",
          divisionName: "A",
          mobile: `+91987661${(1000 + fixtureCounter).toString().padStart(4, "0")}`,
          parentMobile: `+91987662${(1000 + fixtureCounter).toString().padStart(4, "0")}`,
          parentEmail,
          fatherName: "Father",
          fatherOccupation: "Engineer",
          motherName: "Mother",
          motherOccupation: "Doctor",
          workflowStatus: "ASSESSMENT_COMPLETED",
        },
      });
      // Each fixture gets its own date — (counsellorId, date, startTime) is unique.
      const date = addDays(now, 400 + fixtureCounter * 20);
      return { id: student.id, email: user.email, date };
    }

    function manualBody(student: { id: string; date: Date }, overrides: Record<string, unknown> = {}) {
      return {
        studentId: student.id,
        counsellorId: counsellorAId,
        sessionNumber: "SESSION_1",
        date: ymd(student.date),
        startTime: "10:00",
        endTime: "10:45",
        ...overrides,
      };
    }

    const sentTo = () => sendTemplateEmailMock.mock.calls.map(([to, key]) => [to, key]);

    it("sends the student, parent and counsellor confirmation emails", async () => {
      const student = await createStudent("parent-manual-a@test.example");
      const res = await authRequest(app).post("/api/v1/sessions").send(manualBody(student));
      expect(res.status).toBe(201);

      expect(sentTo()).toEqual([
        [student.email, "SESSION_SCHEDULED_CONFIRMATION_STUDENT"],
        ["parent-manual-a@test.example", "SESSION_SCHEDULED_CONFIRMATION_PARENT"],
        ["counsellor-a@test.example", "SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR"],
      ]);
      const expectedWhen = `${formatDisplayDate(student.date)} 10:00`;
      for (const [, , data] of sendTemplateEmailMock.mock.calls) {
        expect(data).toMatchObject({ sessionNumber: "1", sessionDateTime: expectedWhen });
      }
    });

    it("skips the parent email when no parentEmail is on file", async () => {
      const student = await createStudent(null);
      const res = await authRequest(app).post("/api/v1/sessions").send(manualBody(student));
      expect(res.status).toBe(201);

      expect(sentTo()).toEqual([
        [student.email, "SESSION_SCHEDULED_CONFIRMATION_STUDENT"],
        ["counsellor-a@test.example", "SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR"],
      ]);
    });

    it("labels a Session 2 booking as Session 2", async () => {
      const student = await createStudent("parent-manual-s2@test.example");
      const res = await authRequest(app).post("/api/v1/sessions").send(manualBody(student, { sessionNumber: "SESSION_2" }));
      expect(res.status).toBe(201);

      expect(sendTemplateEmailMock).toHaveBeenCalledTimes(3);
      for (const [, , data] of sendTemplateEmailMock.mock.calls) {
        expect(data).toMatchObject({ sessionNumber: "2" });
      }
    });

    it("sends nothing when the request is rejected (409 and 400)", async () => {
      const student = await createStudent("parent-manual-b@test.example");
      const first = await authRequest(app).post("/api/v1/sessions").send(manualBody(student));
      expect(first.status).toBe(201);
      sendTemplateEmailMock.mockClear();

      const conflict = await authRequest(app).post("/api/v1/sessions").send(manualBody(student, { startTime: "12:00", endTime: "12:45" }));
      expect(conflict.status).toBe(409);

      const badCounsellor = await authRequest(app)
        .post("/api/v1/sessions")
        .send(manualBody(student, { sessionNumber: "SESSION_2", counsellorId: "00000000-0000-0000-0000-000000000000" }));
      expect(badCounsellor.status).toBe(400);

      expect(sendTemplateEmailMock).not.toHaveBeenCalled();
    });

    it("still returns 201 when every email send fails", async () => {
      sendTemplateEmailMock.mockRejectedValue(new Error("mail provider down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const student = await createStudent("parent-manual-c@test.example");

      const res = await authRequest(app).post("/api/v1/sessions").send(manualBody(student));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("SCHEDULED");
      expect(sendTemplateEmailMock).toHaveBeenCalledTimes(3);

      errorSpy.mockRestore();
    });

    it("sends the emails when reactivating a CANCELLED row", async () => {
      const student = await createStudent("parent-manual-d@test.example");
      const created = await authRequest(app).post("/api/v1/sessions").send(manualBody(student));
      expect(created.status).toBe(201);
      const cancel = await authRequest(app)
        .post(`/api/v1/sessions/${created.body.id}/cancel`)
        .send({ reason: "COUNSELLOR_UNAVAILABLE", initiatedBy: "ADMIN" });
      expect(cancel.status).toBe(200);
      sendTemplateEmailMock.mockClear();

      const res = await authRequest(app)
        .post("/api/v1/sessions")
        .send(manualBody(student, { counsellorId: counsellorBId, date: ymd(addDays(student.date, 10)) }));
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(created.body.id); // reactivated in place, not a new row

      expect(sentTo()).toEqual([
        [student.email, "SESSION_SCHEDULED_CONFIRMATION_STUDENT"],
        ["parent-manual-d@test.example", "SESSION_SCHEDULED_CONFIRMATION_PARENT"],
        ["counsellor-b@test.example", "SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR"],
      ]);
    });
  });
});
