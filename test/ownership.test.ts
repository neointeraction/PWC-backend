import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const COHORT = "CLASS_9_10";

// Two real students (each with a linked User). A STUDENT token carries `sub = User.id`;
// the ownership guards compare it to the target student's `userId`.
let studentAId: string;
let studentAToken: string; // Bearer for student A's own user
let studentBId: string;
let studentBToken: string;

async function makeStudent(suffix: string, mobile: string, parentMobile: string, projectId: string) {
  const res = await authRequest(app).post("/api/v1/students").send({
    firstName: "Own",
    lastName: suffix,
    email: `own-${suffix}@test-ownership.example`,
    mobile,
    studentCode: `OWN${suffix}`,
    projectId,
    className: "Grade 9",
    divisionName: "A",
    parentMobile,
    parentEmail: `parent-${suffix}@test-ownership.example`,
    fatherName: "F",
    fatherOccupation: "Engineer",
    motherName: "M",
    motherOccupation: "Doctor",
  });
  const id = res.body.student.id as string;
  const row = await prisma.student.findUnique({ where: { id }, select: { userId: true } });
  return { id, token: bearer("STUDENT", { userId: row!.userId }) };
}

describe("Ownership scoping (student self-service)", () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        code: "P-OWN",
        name: "Test Project Ownership",
        address: "1 Own St",
        contactNumber: "+919876579101",
        primaryEmail: "ownership@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });

    // Note: this range (+919876579xxx) is deliberately distinct from the +919876571xxx
    // block that test/sessions.test.ts's noShowFixtureCounter dynamically generates —
    // vitest runs test files concurrently against the same shared test DB, and a fixed
    // literal here previously collided with that counter's output under parallel runs.
    const a = await makeStudent("A", "+919876579002", "+919876579003", project.id);
    studentAId = a.id;
    studentAToken = a.token;
    const b = await makeStudent("B", "+919876579004", "+919876579005", project.id);
    studentBId = b.id;
    studentBToken = b.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-ownership.example" } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Ownership" } });
    await prisma.$disconnect();
  });

  it("lets a student act on their OWN student form", async () => {
    const res = await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentAId}`)
      .set("Authorization", studentAToken)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "Exploring" }] });
    expect(res.status).toBe(200);
  });

  it("403s a student acting on ANOTHER student's form", async () => {
    const res = await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentBId}`)
      .set("Authorization", studentAToken)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "x" }] });
    expect(res.status).toBe(403);
  });

  it("403s a student reading another student's form-status; 200 for their own", async () => {
    const own = await request(app).get(`/api/v1/forms/students/${studentAId}/status`).set("Authorization", studentAToken);
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/v1/forms/students/${studentBId}/status`).set("Authorization", studentAToken);
    expect(other.status).toBe(403);
  });

  it("403s a student starting an assessment attempt for another student (body ownership)", async () => {
    const own = await request(app)
      .post("/api/v1/assessment/attempts")
      .set("Authorization", studentAToken)
      .send({ studentId: studentAId, cohort: COHORT });
    expect(own.status).toBe(200);

    const other = await request(app)
      .post("/api/v1/assessment/attempts")
      .set("Authorization", studentBToken)
      .send({ studentId: studentAId, cohort: COHORT });
    expect(other.status).toBe(403);
  });

  it("403s a student reading another student's attempt (attempt-param ownership)", async () => {
    // Student A's in-progress attempt exists from the previous test.
    const attempt = await prisma.assessmentAttempt.findFirst({ where: { studentId: studentAId }, select: { id: true } });
    const res = await request(app)
      .get(`/api/v1/assessment/attempts/${attempt!.id}`)
      .set("Authorization", studentBToken);
    expect(res.status).toBe(403);
  });

  it("keeps parent forms open regardless of ownership (public link)", async () => {
    // A student token targeting another student's PARENT form still works — parent forms
    // are public (no owner check), because parents have no login.
    const res = await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_PARENT/students/${studentBId}`)
      .set("Authorization", studentAToken)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "x" }] });
    expect(res.status).not.toBe(403);
  });

  it("lets staff act on any student's records (staff bypass)", async () => {
    const res = await request(app)
      .get(`/api/v1/forms/students/${studentAId}/status`)
      .set("Authorization", bearer("COUNSELLOR"));
    expect(res.status).toBe(200);
  });
});
