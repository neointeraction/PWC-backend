import argon2 from "argon2";
import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function hm(date: Date): string {
  return date.toISOString().slice(11, 16);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

let instituteId: string;
let projectId: string;
let divisionId: string;
let counsellorAId: string;
let counsellorBId: string;
let studentId: string;

async function cleanupInstitute(name: string): Promise<void> {
  const inst = await prisma.institute.findUnique({ where: { name } });
  if (!inst) return;
  const projects = await prisma.project.findMany({ where: { instituteId: inst.id } });
  const projectIds = projects.map((p) => p.id);
  const students = await prisma.student.findMany({ where: { projectId: { in: projectIds } } });
  const counsellors = await prisma.counsellor.findMany({ where: { instituteId: inst.id } });
  const userIds = [...students.map((s) => s.userId), ...counsellors.map((c) => c.userId)];

  await prisma.session.deleteMany({ where: { studentId: { in: students.map((s) => s.id) } } });
  await prisma.counsellorSlot.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectCounsellor.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.student.deleteMany({ where: { id: { in: students.map((s) => s.id) } } });
  await prisma.counsellor.deleteMany({ where: { id: { in: counsellors.map((c) => c.id) } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.institute.delete({ where: { id: inst.id } });
}

// Anchor "now" to a fixed minute boundary so slot start/end times stay predictable.
const now = new Date();
now.setUTCSeconds(0, 0);

const session1Start = addMinutes(now, 5); // within the T-10min join window shortly
const session1End = addMinutes(session1Start, 45);
const session1Date = session1Start;

const session2Date = addDays(session1Date, 3);
const session2Start = addMinutes(now, 5);
const session2End = addMinutes(session2Start, 45);

describe("Sessions API", () => {
  beforeAll(async () => {
    await cleanupInstitute("Test Institute Sessions");

    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Sessions",
      address: "1 Session St",
      contactNumber: "+919876570001",
      primaryEmail: "sessions@test-institute.example",
    });
    instituteId = institute.body.id;

    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Sessions",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;

    const klass = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes`)
      .send({ name: "Grade 9" });
    const division = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "A" });
    divisionId = division.body.id;

    const passwordHash = await argon2.hash("temp-password");

    const counsellorAUser = await prisma.user.create({
      data: { email: "counsellor-a@test.example", passwordHash, role: "COUNSELLOR", firstName: "Asha", lastName: "Rao" },
    });
    const counsellorA = await prisma.counsellor.create({
      data: { userId: counsellorAUser.id, counsellorCode: "CN-SESS-A", instituteId, mobile: "+919876570002" },
    });
    counsellorAId = counsellorA.id;

    const counsellorBUser = await prisma.user.create({
      data: { email: "counsellor-b@test.example", passwordHash, role: "COUNSELLOR", firstName: "Bala", lastName: "Iyer" },
    });
    const counsellorB = await prisma.counsellor.create({
      data: { userId: counsellorBUser.id, counsellorCode: "CN-SESS-B", instituteId, mobile: "+919876570003" },
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
        divisionId,
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
    await cleanupInstitute("Test Institute Sessions");
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
    const session1Option = res.body.find((s: { slotDate: string }) => s.slotDate.startsWith(ymd(session1Date)));
    expect(session1Option.startTime).toBe(hm(session1Start));
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
    // A separate, far-future admin-created session — session1 (booked above) starts in
    // ~5 minutes, already inside the 10-minute window, so it can't exercise this case.
    const passwordHash = await argon2.hash("temp-password");
    const otherUser = await prisma.user.create({
      data: { email: "student-sessions-2@test.example", passwordHash, role: "STUDENT", firstName: "Priya", lastName: "Nair" },
    });
    const otherStudent = await prisma.student.create({
      data: {
        userId: otherUser.id,
        studentCode: "SESS-2",
        projectId,
        divisionId,
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

  it("sets the meeting link and allows join once inside the window", async () => {
    const list = await authRequest(app).get(`/api/v1/sessions/students/${studentId}`);
    const session1 = list.body.find((s: { sessionNumber: string }) => s.sessionNumber === "SESSION_1");

    const linkRes = await authRequest(app)
      .patch(`/api/v1/sessions/${session1.id}/meeting-link`)
      .send({ meetingLink: "https://meet.example.com/abc" });
    expect(linkRes.status).toBe(200);

    // session1Start is ~5 minutes out, inside the 10-minute join window.
    const joinRes = await authRequest(app).post(`/api/v1/sessions/${session1.id}/join`).send({ role: "STUDENT" });
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.meetingLink).toBe("https://meet.example.com/abc");
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
        data: { instituteId, name: "Test Project Sessions Unassigned", fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31") },
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
          divisionId,
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
});
