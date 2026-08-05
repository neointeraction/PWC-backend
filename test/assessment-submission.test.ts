import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();
const COHORT = "CLASS_9_10";

let studentId: string;

interface AssessmentQuestion {
  fieldKey: string;
  format: string;
  options: { value: string }[] | null;
}

function buildAnswer(question: AssessmentQuestion): unknown {
  if (question.format === "MCQ_SINGLE") {
    return question.options?.[0]?.value ?? "A";
  }
  return "3"; // LIKERT_5
}

describe("Assessment submission API", () => {
  beforeAll(async () => {
    const institute = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Assessment Submission",
      address: "1 Assessment St",
      contactNumber: "+919876560001",
      primaryEmail: "assessment-submission@test-institute.example",
    });
    const instituteId = institute.body.id;

    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Assessment Submission",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });

    const klass = await request(app)
      .post(`/api/v1/institutes/${instituteId}/classes`)
      .send({ name: "Grade 9" });
    const division = await request(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "A" });

    const student = await request(app).post("/api/v1/students").send({
      firstName: "Kabir",
      lastName: "Shah",
      email: "kabir@test-assessment-submission.example",
      mobile: "+919876560002",
      studentCode: "ASUB1",
      projectId: project.id,
      divisionId: division.body.id,
      parentMobile: "+919876560003",
      parentEmail: "parent-kabir@test-assessment-submission.example",
      fatherName: "Shah Sr",
      fatherOccupation: "Engineer",
      motherName: "Shah Jr",
      motherOccupation: "Doctor",
    });
    studentId = student.body.student.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: "@test-assessment-submission.example" } },
    });
    await prisma.project.deleteMany({ where: { name: "Test Project Assessment Submission" } });
    await prisma.institute.deleteMany({ where: { name: "Test Institute Assessment Submission" } });
    await prisma.$disconnect();
  });

  it("starts a new attempt", async () => {
    const res = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.cohort).toBe(COHORT);
  });

  it("resumes the same in-progress attempt instead of creating a new one", async () => {
    const first = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    const second = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects an unknown fieldKey with 400", async () => {
    const attempt = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    const res = await request(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: [{ fieldKey: "not_a_real_question", selectedOption: "3" }] });

    expect(res.status).toBe(400);
  });

  it("never includes correctOption on the attempt's answered questions", async () => {
    const attempt = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    await request(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: [{ fieldKey: "riasec_realistic_r1", selectedOption: "3" }] });

    const res = await request(app).get(`/api/v1/assessment/attempts/${attempt.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.answers[0].question).not.toHaveProperty("correctOption");
  });

  it("rejects submit with 400 and lists missing fieldKeys when incomplete", async () => {
    const attempt = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    const res = await request(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.error.details.missingFieldKeys)).toBe(true);
    expect(res.body.error.details.missingFieldKeys.length).toBeGreaterThan(0);
  });

  it("submits successfully once every question is answered, and locks it", async () => {
    const attempt = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    const questions = await request(app).get("/api/v1/assessment/questions").query({ cohort: COHORT });

    const answers = questions.body.map((q: AssessmentQuestion) => ({
      fieldKey: q.fieldKey,
      selectedOption: buildAnswer(q),
    }));

    const saveRes = await request(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers });
    expect(saveRes.status).toBe(200);

    const submitRes = await request(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("SUBMITTED");
    expect(submitRes.body.submittedAt).not.toBeNull();

    const resaveRes = await request(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: [{ fieldKey: questions.body[0].fieldKey, selectedOption: "1" }] });
    expect(resaveRes.status).toBe(409);

    const restartRes = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    expect(restartRes.status).toBe(409);
  });
});
