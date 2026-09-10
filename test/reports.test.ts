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
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: "Counsellor-Picked Role" } });
    const industry = await prisma.careerIndustry.findFirst({ where: { name: "Test Reports Industry" } });
    if (industry) {
      await prisma.careerDomain.deleteMany({ where: { industryId: industry.id } });
      await prisma.careerIndustry.deleteMany({ where: { id: industry.id } });
    }
    await prisma.careerCluster.deleteMany({ where: { name: "Test Reports Cluster" } });
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

  it("gives a counsellor-added job role a priority seat in the career compass", async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test Reports Cluster" } });
    const industry = await prisma.careerIndustry.create({
      data: { clusterId: cluster.id, name: "Test Reports Industry" },
    });
    const domain = await prisma.careerDomain.create({
      data: { industryId: industry.id, name: "Test Reports Domain" },
    });
    await prisma.careerLibraryEntry.create({
      data: {
        domainId: domain.id,
        jobRole: "Counsellor-Picked Role",
        aiResilienceGrade: "HIGH",
        aiResilienceComment: "Resilient because reasons",
        oneLineDescription: "Does a counsellor-chosen thing",
        status: "ACTIVE",
        createdBy: "test-seed",
        studentId: studentAId,
      },
    });

    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(200);
    const top6 = res.body.careerCompass.top6Domains as { addedByCounsellor: boolean; representativeCareer: { jobRole: string } }[];
    expect(top6.length).toBeLessThanOrEqual(6);
    expect(top6[0].addedByCounsellor).toBe(true);
    expect(top6[0].representativeCareer.jobRole).toBe("Counsellor-Picked Role");
    expect(top6.filter((c) => c.addedByCounsellor).length).toBe(1);
  });

  it("404s when the student has no assessment result yet", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentBId}/assessment`);
    expect(res.status).toBe(404);
  });

  it("accept: 400 until the chart is finalized, then accepts idempotently and is reflected on the GET", async () => {
    const before = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(before.body.accepted).toBe(false);
    expect(before.body.acceptedAt).toBeNull();

    const tooEarly = await authRequest(app).post(`/api/v1/reports/students/${studentAId}/accept`);
    expect(tooEarly.status).toBe(400);

    // Chart needs real content before it can be finalized.
    await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentAId}`)
      .send({ strengths: ["Curiosity"] });
    await authRequest(app).post(`/api/v1/counsellor-chart/students/${studentAId}/finalize`).send({});

    const accept = await authRequest(app).post(`/api/v1/reports/students/${studentAId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.acceptedAt).toBeTruthy();

    // Idempotent — re-accepting returns the same timestamp.
    const again = await authRequest(app).post(`/api/v1/reports/students/${studentAId}/accept`);
    expect(again.status).toBe(200);
    expect(again.body.acceptedAt).toBe(accept.body.acceptedAt);

    const after = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(after.body.accepted).toBe(true);
    expect(after.body.acceptedAt).toBe(accept.body.acceptedAt);
  });

  it("accept: 404 when the student has no assessment result yet", async () => {
    const res = await authRequest(app).post(`/api/v1/reports/students/${studentBId}/accept`);
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
