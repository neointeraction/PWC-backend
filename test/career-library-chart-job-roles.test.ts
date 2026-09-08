import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const SUFFIX = "@test-cl-chart.example";

// A job role added from a student's Counsellor Chart carries that student (and their
// project) along with it, so the chart can re-list "job roles I already added" on a later
// visit, and the submitting counsellor (only) can edit it while it's still pending.
let counsellorAToken: string;
let counsellorBToken: string;
let studentId: string;
let projectId: string;
let testDomainId: string;

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    domainId: testDomainId,
    studentId,
    jobRole: "Test CLChart Role Base",
    aiResilienceGrade: "HIGH",
    aiResilienceComment: "Resilient because reasons",
    oneLineDescription: "Does a thing",
    ...overrides,
  };
}

describe("Career Library — job roles added from a Counsellor Chart", () => {
  beforeAll(async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test CLChart Cluster" } });
    const industry = await prisma.careerIndustry.create({
      data: { clusterId: cluster.id, name: "Test CLChart Industry" },
    });
    const domain = await prisma.careerDomain.create({
      data: { industryId: industry.id, name: "Test CLChart Domain" },
    });
    testDomainId = domain.id;

    const project = await prisma.project.create({
      data: {
        code: "P-CLCHART",
        name: "Test Project CLChart",
        address: "1 Chart Ln",
        contactNumber: "+919557100001",
        primaryEmail: `institute${SUFFIX}`,
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;

    const student = await authRequest(app).post("/api/v1/students").send({
      firstName: "Chart", lastName: "Student", email: `student${SUFFIX}`,
      mobile: "+919557100002", studentCode: "CLCHART1", projectId: project.id,
      className: "Grade 10", divisionName: "A", parentMobile: "+919557100003",
      parentEmail: `parent${SUFFIX}`, fatherName: "F", motherName: "M",
    });
    studentId = student.body.student.id;

    const counsellorA = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Cara", lastName: "ChartA", email: `cara${SUFFIX}`,
      mobile: "+919557100004", counsellorCode: "CLCHARTCN1",
    });
    counsellorAToken = bearer("COUNSELLOR", { userId: counsellorA.body.counsellor.user.id });

    const counsellorB = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Bara", lastName: "ChartB", email: `bara${SUFFIX}`,
      mobile: "+919557100005", counsellorCode: "CLCHARTCN2",
    });
    counsellorBToken = bearer("COUNSELLOR", { userId: counsellorB.body.counsellor.user.id });
  });

  afterAll(async () => {
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: "Test CLChart Role" } } });
    await prisma.careerLibraryEntryProposal.deleteMany({ where: { jobRole: { startsWith: "Test CLChart Role" } } });
    await prisma.careerDomain.deleteMany({ where: { name: "Test CLChart Domain" } });
    await prisma.careerIndustry.deleteMany({ where: { name: "Test CLChart Industry" } });
    await prisma.careerCluster.deleteMany({ where: { name: "Test CLChart Cluster" } });
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.project.deleteMany({ where: { name: "Test Project CLChart" } });
    await prisma.$disconnect();
  });

  it("stamps a counsellor's chart-added proposal with the student's id and derived projectId", async () => {
    const res = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorAToken)
      .send(entryBody({ jobRole: "Test CLChart Role Stamp" }));

    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe(studentId);
    expect(res.body.projectId).toBe(projectId);
  });

  it("404s when studentId doesn't reference a real student", async () => {
    const res = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorAToken)
      .send(entryBody({ jobRole: "Test CLChart Role BadStudent", studentId: "cknownid0000000000000000" }));
    expect(res.status).toBe(404);
  });

  it("lets the chart re-list job roles a counsellor already added there, scoped to their own", async () => {
    await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorAToken)
      .send(entryBody({ jobRole: "Test CLChart Role ListMine" }));

    const mine = await request(app)
      .get("/api/v1/career-library/proposals")
      .set("Authorization", counsellorAToken)
      .query({ studentId });
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((e: { jobRole: string }) => e.jobRole === "Test CLChart Role ListMine")).toBe(true);

    // Counsellor B never submitted anything for this chart — sees nothing, even scoped to
    // the same studentId, because a non-admin is always further scoped to their own.
    const other = await request(app)
      .get("/api/v1/career-library/proposals")
      .set("Authorization", counsellorBToken)
      .query({ studentId });
    expect(other.status).toBe(200);
    expect(other.body.data.some((e: { jobRole: string }) => e.jobRole === "Test CLChart Role ListMine")).toBe(false);

    // An admin's review queue still sees everyone's.
    const admin = await authRequest(app).get("/api/v1/career-library/proposals").query({ studentId });
    expect(admin.body.data.some((e: { jobRole: string }) => e.jobRole === "Test CLChart Role ListMine")).toBe(true);
  });

  it("lets the submitting counsellor edit their own pending proposal", async () => {
    const created = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorAToken)
      .send(entryBody({ jobRole: "Test CLChart Role EditMine" }));

    const edited = await request(app)
      .patch(`/api/v1/career-library/proposals/${created.body.id}`)
      .set("Authorization", counsellorAToken)
      .send({ oneLineDescription: "Updated description" });
    expect(edited.status).toBe(200);
    expect(edited.body.oneLineDescription).toBe("Updated description");
    expect(edited.body.studentId).toBe(studentId);
  });

  it("403s another counsellor editing a proposal they didn't submit", async () => {
    const created = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorAToken)
      .send(entryBody({ jobRole: "Test CLChart Role NotYours" }));

    const res = await request(app)
      .patch(`/api/v1/career-library/proposals/${created.body.id}`)
      .set("Authorization", counsellorBToken)
      .send({ oneLineDescription: "Sneaky edit" });
    expect(res.status).toBe(403);
  });

  it("carries studentId/projectId onto the published entry once an admin approves it", async () => {
    const created = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorAToken)
      .send(entryBody({ jobRole: "Test CLChart Role Approve" }));

    const approved = await authRequest(app).post(`/api/v1/career-library/proposals/${created.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.studentId).toBe(studentId);
    expect(approved.body.projectId).toBe(projectId);

    const list = await authRequest(app).get("/api/v1/career-library").query({ studentId, status: "ACTIVE" });
    expect(list.body.data.some((e: { id: string }) => e.id === approved.body.id)).toBe(true);
  });
});
