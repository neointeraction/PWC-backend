import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authRequest, bearer } from "./helpers/http.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();
const COHORT = "CLASS_9_10";
const SUFFIX = "@test-workflow-lifecycle.example";

// The tail of the 12-stage lifecycle — everything from the counsellor chart onwards.
// The earlier hops (profile, forms, assessment, sessions) are covered by their own
// module tests; this file exists because those last four stages used to be reachable
// only through the admin override.
let studentId: string;
let studentToken: string;
let earlyStudentId: string;
let earlyStudentToken: string;

interface AssessmentQuestion { fieldKey: string; format: string; options: { value: string }[] | null }
interface TemplateQuestion { fieldKey: string; questionType: string }

async function statusOf(id: string): Promise<string> {
  const s = await prisma.student.findUniqueOrThrow({ where: { id }, select: { workflowStatus: true } });
  return s.workflowStatus;
}

async function submitFeedback(id: string, formType: string): Promise<void> {
  const template = await authRequest(app).get(`/api/v1/forms/${formType}`).query({ cohort: COHORT });
  const answers = (template.body.questions as TemplateQuestion[]).map((q) => ({
    fieldKey: q.fieldKey,
    answer: q.questionType === "SCALE" ? "4" : "n/a",
  }));
  await authRequest(app).post(`/api/v1/forms/${formType}/students/${id}/submit`).send({ cohort: COHORT, answers });
}

describe("Workflow lifecycle — chart, finalize, feedback pair, closure", () => {
  beforeAll(async () => {
    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Workflow Lifecycle",
      address: "12 Lifecycle Ln",
      contactNumber: "+919557000001",
      primaryEmail: `institute${SUFFIX}`,
    });
    const instituteId = institute.body.id;
    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Workflow Lifecycle",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    const klass = await authRequest(app).post(`/api/v1/institutes/${instituteId}/classes`).send({ name: "Grade 10" });
    const division = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "W" });

    // A student with a scored assessment (so the report endpoint resolves), plus their
    // own STUDENT token — ownership compares the token's `sub` to Student.userId.
    async function makeStudentWithAssessment(n: number) {
      const res = await authRequest(app).post("/api/v1/students").send({
        firstName: "Wf", lastName: `Student${n}`, email: `student${n}${SUFFIX}`,
        mobile: `+91955700010${n}`, studentCode: `WF${n}`, projectId: project.id,
        divisionId: division.body.id, parentMobile: `+91955700020${n}`, parentEmail: `parent${n}${SUFFIX}`,
        fatherName: "F", fatherOccupation: "Eng", motherName: "M", motherOccupation: "Dr",
      });
      const id = res.body.student.id as string;

      const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId: id, cohort: COHORT });
      const questions = await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT });
      await authRequest(app).put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`).send({
        answers: (questions.body as AssessmentQuestion[]).map((q) => ({
          fieldKey: q.fieldKey,
          selectedOption: q.format === "MCQ_SINGLE" ? q.options?.[0]?.value ?? "A" : "4",
        })),
      });
      await authRequest(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);

      const row = await prisma.student.findUniqueOrThrow({ where: { id }, select: { userId: true } });
      return { id, token: bearer("STUDENT", { userId: row.userId }) };
    }

    const main = await makeStudentWithAssessment(1);
    studentId = main.id;
    studentToken = main.token;
    const early = await makeStudentWithAssessment(2);
    earlyStudentId = early.id;
    earlyStudentToken = early.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Workflow Lifecycle" } });
    await prisma.institute.deleteMany({ where: { name: "Test Institute Workflow Lifecycle" } });
    await prisma.$disconnect();
  });

  it("starts at ASSESSMENT_COMPLETED after the scored attempt", async () => {
    expect(await statusOf(studentId)).toBe("ASSESSMENT_COMPLETED");
  });

  it("a chart save carrying only the audit stamp doesn't advance anything", async () => {
    const res = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({ lastEditedBy: "counsellor-1" });
    expect(res.status).toBe(200);
    expect(await statusOf(studentId)).toBe("ASSESSMENT_COMPLETED");
  });

  it("refuses to finalize an empty chart", async () => {
    const res = await authRequest(app).post(`/api/v1/counsellor-chart/students/${studentId}/finalize`).send({});
    expect(res.status).toBe(400);
    expect(await statusOf(studentId)).toBe("ASSESSMENT_COMPLETED");
  });

  it("saving real chart content advances to COUNSELLOR_FEEDBACK_REPORT", async () => {
    const res = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({
        notes: [{ code: "A1", body: "Strong science anchor; parent agrees." }],
        scri: { confidence: 4, reasonedThinking: 3, reducedAnxiety: 3, selfAwareness: 4, careerCuriosity: 4, decisionOwnership: 3 },
        strengths: ["curiosity"],
        lastEditedBy: "counsellor-1",
      });
    expect(res.status).toBe(200);
    expect(await statusOf(studentId)).toBe("COUNSELLOR_FEEDBACK_REPORT");
  });

  it("finalize stamps finalizedAt, advances to COUNSELLOR_FEEDBACK, and is idempotent", async () => {
    const res = await authRequest(app)
      .post(`/api/v1/counsellor-chart/students/${studentId}/finalize`)
      .send({ finalizedBy: "counsellor-1" });
    expect(res.status).toBe(200);
    expect(res.body.counsellor.finalizedAt).not.toBeNull();
    expect(await statusOf(studentId)).toBe("COUNSELLOR_FEEDBACK");

    const again = await authRequest(app).post(`/api/v1/counsellor-chart/students/${studentId}/finalize`).send({});
    expect(again.status).toBe(200);
    expect(again.body.counsellor.finalizedAt).toBe(res.body.counsellor.finalizedAt); // original kept
  });

  it("the report surfaces meta.finalized once the chart is finalized", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentId}/assessment`);
    expect(res.status).toBe(200);
    expect(res.body.meta.finalized).toBe(true);
  });

  it("one feedback form alone doesn't advance; the pair does", async () => {
    await submitFeedback(studentId, "FEEDBACK_STUDENT");
    expect(await statusOf(studentId)).toBe("COUNSELLOR_FEEDBACK");

    await submitFeedback(studentId, "FEEDBACK_PARENT");
    expect(await statusOf(studentId)).toBe("STUDENT_PARENT_FEEDBACK");
  });

  it("a staff fetch of the report does not close the case", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentId}/assessment`);
    expect(res.status).toBe(200);
    expect(await statusOf(studentId)).toBe("STUDENT_PARENT_FEEDBACK");
  });

  it("the student receiving their own report closes the case", async () => {
    const res = await authRequest(app, "STUDENT")
      .get(`/api/v1/reports/students/${studentId}/assessment`)
      .set("Authorization", studentToken);
    expect(res.status).toBe(200);
    expect(await statusOf(studentId)).toBe("CLOSED");
  });

  it("a student fetching their report early does NOT skip the rest of the lifecycle", async () => {
    const res = await authRequest(app, "STUDENT")
      .get(`/api/v1/reports/students/${earlyStudentId}/assessment`)
      .set("Authorization", earlyStudentToken);
    expect(res.status).toBe(200);
    expect(await statusOf(earlyStudentId)).toBe("ASSESSMENT_COMPLETED");
  });
});
