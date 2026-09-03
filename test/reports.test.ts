import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const COHORT = "CLASS_9_10";

let studentAId: string;
let studentAToken: string;
let studentBId: string;

interface Q { fieldKey: string; format: string; options: { value: string }[] | null }

async function makeStudent(suffix: string, mobile: string, parentMobile: string, projectId: string) {
  const res = await authRequest(app).post("/api/v1/students").send({
    firstName: "Rep",
    lastName: suffix,
    email: `rep-${suffix}@test-reports.example`,
    mobile,
    studentCode: `REP${suffix}`,
    projectId,
    className: "Grade 9",
    divisionName: "A",
    parentMobile,
    parentEmail: `parent-${suffix}@test-reports.example`,
    fatherName: "F",
    fatherOccupation: "Engineer",
    motherName: "M",
    motherOccupation: "Doctor",
  });
  return res.body.student.id as string;
}

describe("Reports — student assessment report", () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        code: "P-REP",
        name: "Test Project Reports",
        address: "1 Rep St",
        contactNumber: "+919876575001",
        primaryEmail: "reports@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });

    studentAId = await makeStudent("A", "+919876575002", "+919876575003", project.id);
    studentBId = await makeStudent("B", "+919876575004", "+919876575005", project.id);

    const rowA = await prisma.student.findUnique({ where: { id: studentAId }, select: { userId: true } });
    studentAToken = bearer("STUDENT", { userId: rowA!.userId });

    // Run the full assessment for student A so a computed result exists.
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId: studentAId, cohort: COHORT });
    const questions = (await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT })).body as Q[];
    const answers = questions.map((q) => ({ fieldKey: q.fieldKey, selectedOption: q.format === "MCQ_SINGLE" ? q.options?.[0]?.value ?? "A" : "5" }));
    await authRequest(app).put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`).send({ answers });
    await authRequest(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-reports.example" } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Reports" } });
    await prisma.$disconnect();
  });

  it("assembles the full report once the assessment is submitted", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.student.name).toBe("Rep A");
    expect(b.student.institute).toBe("Test Project Reports");
    expect(b.championProfile.dominantCareerStyle.code).toHaveLength(3);
    expect(b.championProfile.dominantPersonalityStyle.code).toContain("-");
    expect(b.traitMap.riasec.scores).toHaveLength(6);
    expect(Object.keys(b.traitMap.traitScores)).toHaveLength(18);
    expect(b.careerCompass).not.toBeNull();
    expect(Array.isArray(b.streamFit.top3)).toBe(true);
    expect(Array.isArray(b.graduationPathways.top3)).toBe(true);
    expect(b.reliability.rvs).toBeTruthy();
    expect(b.counsellorNarrative).toBeNull(); // no chart authored yet
    expect(b.feedback).toBeTruthy(); // { complete:false, ... } since forms aren't in
    expect(b.meta.cohort).toBe(COHORT);
    expect(b.meta.finalized).toBe(false);
  });

  it("404s when the student has no assessment result yet", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentBId}/assessment`);
    expect(res.status).toBe(404);
  });

  it("lets a student read their own report, but not another's", async () => {
    const own = await request(app).get(`/api/v1/reports/students/${studentAId}/assessment`).set("Authorization", studentAToken);
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/v1/reports/students/${studentBId}/assessment`).set("Authorization", studentAToken);
    expect(other.status).toBe(403);
  });

  it("401s without a token", async () => {
    const res = await request(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(401);
  });
});
