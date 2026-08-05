import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();
const COHORT = "CLASS_9_10";

let studentId: string;

interface TemplateQuestion {
  fieldKey: string;
  questionType: string;
  options: unknown;
}

// Builds a generically valid, non-empty answer for any question shape so the
// "submit successfully" test doesn't need to hardcode this form's real content.
function buildAnswer(question: TemplateQuestion): unknown {
  const options = question.options as { value: string }[] | undefined;
  switch (question.questionType) {
    case "MCQ_SINGLE":
      return options?.[0]?.value ?? "a";
    case "MCQ_MULTI":
      return [options?.[0]?.value ?? "a"];
    case "NUMBER":
      return 5;
    case "SCALE":
      return options?.[0]?.value ?? "3";
    case "MATRIX":
      return { sample: "value" };
    default:
      return "Test answer";
  }
}

describe("Forms submission API", () => {
  beforeAll(async () => {
    const institute = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Forms Submission",
      address: "1 Form St",
      contactNumber: "+919876550001",
      primaryEmail: "forms-submission@test-institute.example",
    });
    const instituteId = institute.body.id;

    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Forms Submission",
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
      firstName: "Priya",
      lastName: "Menon",
      email: "priya@test-form-submission.example",
      mobile: "+919876550002",
      studentCode: "FSUB1",
      projectId: project.id,
      divisionId: division.body.id,
      parentMobile: "+919876550003",
      parentEmail: "parent-priya@test-form-submission.example",
      fatherName: "Menon Sr",
      fatherOccupation: "Engineer",
      motherName: "Menon Jr",
      motherOccupation: "Doctor",
    });
    studentId = student.body.student.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-form-submission.example" } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Forms Submission" } });
    await prisma.institute.deleteMany({ where: { name: "Test Institute Forms Submission" } });
    await prisma.$disconnect();
  });

  it("saves a draft with partial answers", async () => {
    const res = await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "Still Exploring" }] });

    expect(res.status).toBe(200);
    expect(res.body.submittedAt).toBeNull();
    expect(res.body.answers).toHaveLength(1);
  });

  it("rejects an unknown fieldKey with 400", async () => {
    const res = await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "not_a_real_field", answer: "x" }] });

    expect(res.status).toBe(400);
  });

  it("fetches the draft submission with its answers", async () => {
    const res = await request(app)
      .get(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .query({ cohort: COHORT });

    expect(res.status).toBe(200);
    expect(res.body.submittedAt).toBeNull();
    expect(res.body.answers[0].question.fieldKey).toBe("career_in_mind");
  });

  it("rejects submit with 400 and lists missing required fieldKeys", async () => {
    const res = await request(app)
      .post(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}/submit`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "Still Exploring" }] });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.error.details.missingFieldKeys)).toBe(true);
    expect(res.body.error.details.missingFieldKeys.length).toBeGreaterThan(0);
  });

  it("submits successfully once every required question is answered, and locks it", async () => {
    const template = await request(app)
      .get("/api/v1/forms/PRE_COUNSELLING_STUDENT")
      .query({ cohort: COHORT });

    const requiredQuestions = template.body.questions.filter((q: { isRequired: boolean }) => q.isRequired);
    const answers = requiredQuestions.map((q: TemplateQuestion) => ({
      fieldKey: q.fieldKey,
      answer: buildAnswer(q),
    }));

    const submitRes = await request(app)
      .post(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}/submit`)
      .send({ cohort: COHORT, answers });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.submittedAt).not.toBeNull();

    const lockedRes = await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "changed" }] });

    expect(lockedRes.status).toBe(409);
  });
});
