import request from "supertest";
import { authRequest } from "./helpers/http.js";
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
  return "5"; // LIKERT_5 — "Strongly Agree" so interest/personality traits score high
              // enough to clear the Fit qualifying floor and surface recommendations.
}

describe("Assessment submission API", () => {
  beforeAll(async () => {
    const institute = await authRequest(app).post("/api/v1/institutes").send({
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

    const klass = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes`)
      .send({ name: "Grade 9" });
    const division = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "A" });

    const student = await authRequest(app).post("/api/v1/students").send({
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

  it("lists questions in the interleaved presentation order, not grouped by trait", async () => {
    const res = await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT });
    expect(res.status).toBe(200);
    const displayOrders = res.body.map((q: { displayOrder: number }) => q.displayOrder);
    // Returned sorted by displayOrder 1..73.
    expect(displayOrders).toEqual([...displayOrders].sort((a, b) => a - b));
    expect(displayOrders[0]).toBe(1);
    // The first delivered question is Q13 (Social) — traits are interleaved, so the
    // opening run is NOT all-RIASEC-then-all-BigFive.
    expect(res.body[0].questionCode).toBe("Q13");
    const firstSixSections = res.body.slice(0, 6).map((q: { section: string }) => q.section);
    expect(new Set(firstSixSections).size).toBeGreaterThan(1);
  });

  it("starts a new attempt", async () => {
    const res = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.cohort).toBe(COHORT);
  });

  it("resumes the same in-progress attempt instead of creating a new one", async () => {
    const first = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    const second = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects an unknown fieldKey with 400", async () => {
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    const res = await authRequest(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: [{ fieldKey: "not_a_real_question", selectedOption: "3" }] });

    expect(res.status).toBe(400);
  });

  it("never includes correctOption on the attempt's answered questions", async () => {
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    await authRequest(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: [{ fieldKey: "riasec_realistic_r1", selectedOption: "3" }] });

    const res = await authRequest(app).get(`/api/v1/assessment/attempts/${attempt.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.answers[0].question).not.toHaveProperty("correctOption");
  });

  it("rejects submit with 400 and lists missing fieldKeys when incomplete", async () => {
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });

    const res = await authRequest(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.error.details.missingFieldKeys)).toBe(true);
    expect(res.body.error.details.missingFieldKeys.length).toBeGreaterThan(0);
  });

  it("submits successfully once every question is answered, and locks it", async () => {
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    const questions = await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT });

    const answers = questions.body.map((q: AssessmentQuestion) => ({
      fieldKey: q.fieldKey,
      selectedOption: buildAnswer(q),
    }));

    const saveRes = await authRequest(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers });
    expect(saveRes.status).toBe(200);

    const submitRes = await authRequest(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("SUBMITTED");
    expect(submitRes.body.submittedAt).not.toBeNull();

    // The scoring engine ran on submit — the computed report is now retrievable.
    const resultRes = await authRequest(app).get(`/api/v1/assessment/attempts/${attempt.body.id}/result`);
    expect(resultRes.status).toBe(200);
    expect(Object.keys(resultRes.body.traitScores)).toHaveLength(18);
    expect(resultRes.body.dominantCareerStyle).toBeTruthy();
    expect(resultRes.body.report.reliability.aci).toBeTruthy();
    // All "Strongly Agree" (5) Likert responses -> every interest/personality trait at 100%.
    expect(resultRes.body.report.riasec.scores[0].score).toBe(100);

    // Recommendations are the top qualifying options (Fit Score >= 60): at most 3, and
    // every one surfaced must clear the floor. recommendedStreams mirrors streamFit.top3.
    const streamTop3 = resultRes.body.report.streamFit.top3;
    expect(streamTop3.length).toBeGreaterThan(0);
    expect(streamTop3.length).toBeLessThanOrEqual(3);
    expect(streamTop3.every((s: { fitScore: number }) => s.fitScore >= 60)).toBe(true);
    expect(resultRes.body.recommendedStreams).toHaveLength(streamTop3.length);

    // Graduation Pathways always computes; Career Fit resolves against the seeded
    // career library, with a representative career per top qualifying domain.
    const gradTop3 = resultRes.body.report.graduationPathways.top3;
    expect(gradTop3.length).toBeGreaterThan(0);
    expect(gradTop3.length).toBeLessThanOrEqual(3);
    expect(gradTop3.every((g: { fitScore: number }) => g.fitScore >= 60)).toBe(true);

    const careerFit = resultRes.body.report.careerFit;
    expect(careerFit).not.toBeNull();
    expect(careerFit.top3Industries.length).toBeGreaterThan(0);
    expect(careerFit.top6Domains.length).toBeGreaterThan(0);
    expect(careerFit.top6Domains.every((d: { fitScore: number }) => d.fitScore >= 60)).toBe(true);
    expect(careerFit.top6Domains[0].representativeCareer.jobRole).toBeTruthy();

    const resaveRes = await authRequest(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: [{ fieldKey: questions.body[0].fieldKey, selectedOption: "1" }] });
    expect(resaveRes.status).toBe(409);

    const restartRes = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    expect(restartRes.status).toBe(409);
  });
});
