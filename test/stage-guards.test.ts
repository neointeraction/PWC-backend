import argon2 from "argon2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authRequest } from "./helpers/http.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { advanceWorkflowStatus } from "../src/common/workflow/workflowStatus.js";

vi.mock("../src/modules/email/email.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/email/email.service.js")>()),
  sendTemplateEmail: vi.fn().mockResolvedValue({}),
}));

const app = createApp();
const PROJECT_NAME = "Test Project Stage Guards";
let projectId: string;
let n = 0;

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { name: PROJECT_NAME } });
  const ids = projects.map((p) => p.id);
  if (!ids.length) return;
  const students = await prisma.student.findMany({ where: { projectId: { in: ids } } });
  const sIds = students.map((s) => s.id);
  await prisma.assessmentAttempt.deleteMany({ where: { studentId: { in: sIds } } });
  await prisma.formSubmission.deleteMany({ where: { studentId: { in: sIds } } });
  await prisma.student.deleteMany({ where: { id: { in: sIds } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: students.map((s) => s.userId) } } });
}

async function makeStudent(workflowStatus: "DRAFT" | "PROFILE_COMPLETED" | "SESSION_SCHEDULED") {
  n += 1;
  const user = await prisma.user.create({
    data: { email: `stage-guard-${n}@test.example`, passwordHash: await argon2.hash("x"), role: "STUDENT", firstName: "Guard", lastName: `S${n}` },
  });
  const student = await prisma.student.create({
    data: {
      userId: user.id, studentCode: `GUARD-${n}`, projectId, className: "Grade 9", divisionName: "A",
      mobile: `+91987766${(1000 + n).toString().padStart(4, "0")}`, parentMobile: `+91987767${(1000 + n).toString().padStart(4, "0")}`,
      parentEmail: `parent-guard-${n}@test.example`, fatherName: "F", fatherOccupation: "E", motherName: "M", motherOccupation: "D",
      workflowStatus,
    },
  });
  return student.id;
}
const stageOf = async (id: string) => (await prisma.student.findUniqueOrThrow({ where: { id } })).workflowStatus;

beforeAll(async () => {
  await cleanup();
  const project = await prisma.project.create({
    data: { code: "P-GUARD", name: PROJECT_NAME, address: "1 St", contactNumber: "+919876590001", primaryEmail: "guard@test-project.example",
      fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31") },
  });
  projectId = project.id;
});
afterAll(cleanup);

describe("Stage guards — a student can't act on a stage they haven't reached", () => {
  it("rejects the feedback forms (draft and submit) until Session 2 is completed", async () => {
    const id = await makeStudent("SESSION_SCHEDULED");
    for (const formType of ["FEEDBACK_STUDENT", "FEEDBACK_PARENT"]) {
      const draft = await authRequest(app).put(`/api/v1/forms/${formType}/students/${id}`).send({ cohort: "CLASS_9_10", answers: [{ fieldKey: "any", answer: "x" }] });
      expect(draft.status).toBe(409);
      const submit = await authRequest(app).post(`/api/v1/forms/${formType}/students/${id}/submit`).send({ cohort: "CLASS_9_10", answers: [{ fieldKey: "any", answer: "x" }] });
      expect(submit.status).toBe(409);
    }
    expect(await stageOf(id)).toBe("SESSION_SCHEDULED");
  });

  it("rejects the pre-counselling forms until the profile is confirmed", async () => {
    const id = await makeStudent("DRAFT");
    for (const formType of ["PRE_COUNSELLING_STUDENT", "PRE_COUNSELLING_PARENT"]) {
      const res = await authRequest(app).post(`/api/v1/forms/${formType}/students/${id}/submit`).send({ cohort: "CLASS_9_10", answers: [{ fieldKey: "any", answer: "x" }] });
      expect(res.status).toBe(409);
    }
  });

  it("rejects starting the assessment before the pre-counselling forms are submitted", async () => {
    const id = await makeStudent("PROFILE_COMPLETED");
    const res = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId: id, cohort: "CLASS_9_10" });
    expect(res.status).toBe(409);
    expect(await stageOf(id)).toBe("PROFILE_COMPLETED");
  });

  it("advanceWorkflowStatus refuses to skip past a missing prerequisite stage", async () => {
    const id = await makeStudent("DRAFT");
    await advanceWorkflowStatus(prisma, id, "STUDENT_PARENT_FEEDBACK");
    expect(await stageOf(id)).toBe("DRAFT");
    await advanceWorkflowStatus(prisma, id, "SESSION_SCHEDULED");
    expect(await stageOf(id)).toBe("DRAFT");
    await advanceWorkflowStatus(prisma, id, "PROFILE_COMPLETED"); // the legitimate next step
    expect(await stageOf(id)).toBe("PROFILE_COMPLETED");
  });
});
