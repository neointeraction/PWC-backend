import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();
const COHORT = "CLASS_9_10";

let studentId: string;
let instituteId: string;
let divisionId: string;

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
    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Forms Submission",
      address: "1 Form St",
      contactNumber: "+919876550001",
      primaryEmail: "forms-submission@test-institute.example",
    });
    instituteId = institute.body.id;

    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Forms Submission",
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
    divisionId = division.body.id;

    const student = await authRequest(app).post("/api/v1/students").send({
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
    const res = await authRequest(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "Still Exploring" }] });

    expect(res.status).toBe(200);
    expect(res.body.submittedAt).toBeNull();
    expect(res.body.answers).toHaveLength(1);
  });

  it("rejects an unknown fieldKey with 400", async () => {
    const res = await authRequest(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "not_a_real_field", answer: "x" }] });

    expect(res.status).toBe(400);
  });

  it("fetches the draft submission with its answers", async () => {
    const res = await authRequest(app)
      .get(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .query({ cohort: COHORT });

    expect(res.status).toBe(200);
    expect(res.body.submittedAt).toBeNull();
    expect(res.body.answers[0].question.fieldKey).toBe("career_in_mind");
  });

  it("rejects submit with 400 and lists missing required fieldKeys", async () => {
    const res = await authRequest(app)
      .post(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}/submit`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "Still Exploring" }] });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.error.details.missingFieldKeys)).toBe(true);
    expect(res.body.error.details.missingFieldKeys.length).toBeGreaterThan(0);
  });

  it("submits successfully once every required question is answered, and locks it", async () => {
    const template = await authRequest(app)
      .get("/api/v1/forms/PRE_COUNSELLING_STUDENT")
      .query({ cohort: COHORT });

    const requiredQuestions = template.body.questions.filter((q: { isRequired: boolean }) => q.isRequired);
    const answers = requiredQuestions.map((q: TemplateQuestion) => ({
      fieldKey: q.fieldKey,
      answer: buildAnswer(q),
    }));

    const submitRes = await authRequest(app)
      .post(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}/submit`)
      .send({ cohort: COHORT, answers });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.submittedAt).not.toBeNull();

    const lockedRes = await authRequest(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "changed" }] });

    expect(lockedRes.status).toBe(409);
  });

  it("reports per-form submission flags (only finalized forms count)", async () => {
    // At this point only PRE_COUNSELLING_STUDENT has been submitted (previous test).
    const res = await authRequest(app).get(`/api/v1/forms/students/${studentId}/status`);
    expect(res.status).toBe(200);
    expect(res.body.forms.preCounsellingStudent.submitted).toBe(true);
    expect(res.body.forms.preCounsellingStudent.submittedAt).not.toBeNull();
    expect(res.body.forms.preCounsellingParent.submitted).toBe(false);
    expect(res.body.forms.preCounsellingParent.submittedAt).toBeNull();
    expect(res.body.forms.feedbackParent.submitted).toBe(false);
    expect(res.body.preCounsellingComplete).toBe(false); // parent side missing
    expect(res.body.feedbackComplete).toBe(false);
  });

  it("404s the status for an unknown student", async () => {
    const res = await authRequest(app).get("/api/v1/forms/students/clzzzzzzzzzzzzzzzzzzzzzzzz/status");
    expect(res.status).toBe(404);
  });

  it("rejects saving/submitting once the student's project has ended (403)", async () => {
    // A student whose project ended yesterday — the no-login link must be closed.
    const expiredProject = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Forms Submission Expired",
        fromDate: new Date("2025-01-01"),
        toDate: new Date("2025-12-31"),
      },
    });
    const expiredStudent = await authRequest(app).post("/api/v1/students").send({
      firstName: "Old",
      lastName: "Cohort",
      email: "old@test-form-submission.example",
      mobile: "+919876550009",
      studentCode: "FSUBEXP",
      projectId: expiredProject.id,
      divisionId,
      parentMobile: "+919876550010",
      parentEmail: "parent-old@test-form-submission.example",
      fatherName: "Cohort Sr",
      fatherOccupation: "Engineer",
      motherName: "Cohort Jr",
      motherOccupation: "Doctor",
    });
    const expiredStudentId = expiredStudent.body.student.id;

    const draftRes = await authRequest(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_PARENT/students/${expiredStudentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "x" }] });
    expect(draftRes.status).toBe(403);
    expect(draftRes.body.error.details.reason).toBe("PROJECT_EXPIRED");

    const submitRes = await authRequest(app)
      .post(`/api/v1/forms/PRE_COUNSELLING_PARENT/students/${expiredStudentId}/submit`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "x" }] });
    expect(submitRes.status).toBe(403);

    await prisma.project.delete({ where: { id: expiredProject.id } });
  });

  it("still allows writes on the project's end date itself (end date inclusive)", async () => {
    // toDate == today (UTC midnight) -> the whole of today is still open.
    const now = new Date();
    const endsToday = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Forms Submission EndsToday",
        fromDate: new Date("2025-01-01"),
        toDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      },
    });
    const student = await authRequest(app).post("/api/v1/students").send({
      firstName: "Today",
      lastName: "Cohort",
      email: "today@test-form-submission.example",
      mobile: "+919876550011",
      studentCode: "FSUBTODAY",
      projectId: endsToday.id,
      divisionId,
      parentMobile: "+919876550012",
      parentEmail: "parent-today@test-form-submission.example",
      fatherName: "Today Sr",
      fatherOccupation: "Engineer",
      motherName: "Today Jr",
      motherOccupation: "Doctor",
    });

    const res = await authRequest(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${student.body.student.id}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "career_in_mind", answer: "Exploring" }] });
    expect(res.status).toBe(200); // not 403 — end date is inclusive

    await prisma.project.delete({ where: { id: endsToday.id } });
  });
});
