import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

let testDomainId: string; // live taxonomy leaf the created entries point at

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    domainId: testDomainId,
    jobRole: "Test Norm Role",
    aiResilienceGrade: "HIGH",
    aiResilienceComment: "x",
    oneLineDescription: "x",
    qualification10th12th: "Any",
    ...overrides,
  };
}

describe("Career Library normalization (select-or-add + dropdowns)", () => {
  beforeAll(async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test Norm Cluster" } });
    const industry = await prisma.careerIndustry.create({
      data: { clusterId: cluster.id, name: "Test Norm Industry" },
    });
    const domain = await prisma.careerDomain.create({
      data: { industryId: industry.id, name: "Test Norm Domain" },
    });
    testDomainId = domain.id;
  });

  afterAll(async () => {
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: "Test Norm Role" } } });
    await prisma.careerDomain.deleteMany({ where: { name: "Test Norm Domain" } });
    await prisma.careerIndustry.deleteMany({ where: { name: "Test Norm Industry" } });
    await prisma.careerCluster.deleteMany({ where: { name: "Test Norm Cluster" } });
    await prisma.entranceExam.deleteMany({ where: { name: { startsWith: "Test Norm " } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: "Test Norm " } } });
    await prisma.institution.deleteMany({ where: { name: { startsWith: "Test Norm " } } });
    await prisma.$disconnect();
  });

  it("dropdown endpoints return canonical rows and honour search/level; 401 without token", async () => {
    const exams = await authRequest(app).get("/api/v1/career-library/entrance-exams").query({ level: "UG", limit: 5 });
    expect(exams.status).toBe(200);
    expect(Array.isArray(exams.body)).toBe(true);
    expect(exams.body.every((e: { level: string }) => e.level === "UG")).toBe(true);

    const insts = await authRequest(app).get("/api/v1/career-library/institutions").query({ limit: 5 });
    expect(insts.status).toBe(200);
    expect(insts.body.length).toBeGreaterThan(0);

    const noToken = await request(app).get("/api/v1/career-library/courses");
    expect(noToken.status).toBe(401);
  });

  it("creates an entry with a mix of existing (id) and new (name) links", async () => {
    // Grab an existing canonical exam + institution to link by id.
    const existingExam = (await authRequest(app).get("/api/v1/career-library/entrance-exams").query({ level: "UG", limit: 1 })).body[0];
    const existingInst = (await authRequest(app).get("/api/v1/career-library/institutions").query({ limit: 1 })).body[0];

    const res = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Norm Role Create",
        entranceExams: [{ id: existingExam.id }, { name: "Test Norm Exam PG", level: "PG" }],
        courses: [{ name: "Test Norm Course" }],
        institutions: [{ id: existingInst.id }, { name: "Test Norm College", city: "Pune" }],
      })
    );
    expect(res.status).toBe(201);

    // Response is the assembled entry with flattened links.
    const names = res.body.linkedEntranceExams.map((e: { name: string }) => e.name);
    expect(names).toContain(existingExam.name);
    expect(names).toContain("Test Norm Exam PG");
    expect(res.body.linkedCourses.map((c: { name: string }) => c.name)).toContain("Test Norm Course");
    expect(res.body.linkedInstitutions.map((i: { name: string }) => i.name)).toContain("Test Norm College");

    // Dual-write: the transitional String[] columns are derived from the resolved names.
    expect(res.body.entranceExamsPG).toContain("Test Norm Exam PG");
    expect(res.body.topCourses).toContain("Test Norm Course");

    // The new-by-name exam/college/course were find-or-created as canonical rows.
    const created = await authRequest(app).get("/api/v1/career-library/entrance-exams").query({ search: "Test Norm Exam PG", level: "PG" });
    expect(created.body.some((e: { name: string }) => e.name === "Test Norm Exam PG")).toBe(true);
  });

  it("find-or-create reuses an existing canonical row by name (no duplicate)", async () => {
    await authRequest(app).post("/api/v1/career-library").send(
      entryBody({ jobRole: "Test Norm Role Reuse A", institutions: [{ name: "Test Norm Shared College" }] })
    );
    await authRequest(app).post("/api/v1/career-library").send(
      entryBody({ jobRole: "Test Norm Role Reuse B", institutions: [{ name: "Test Norm Shared College" }] })
    );
    const rows = await prisma.institution.findMany({ where: { name: "Test Norm Shared College" } });
    expect(rows).toHaveLength(1); // deduped by unique name
  });

  it("update REPLACES a provided link array and leaves omitted ones unchanged", async () => {
    const created = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Norm Role Update",
        institutions: [{ name: "Test Norm College One" }, { name: "Test Norm College Two" }],
        courses: [{ name: "Test Norm Course Keep" }],
      })
    );
    const id = created.body.id;
    expect(created.body.linkedInstitutions).toHaveLength(2);

    // Replace institutions with one; omit courses (should stay).
    const updated = await authRequest(app).patch(`/api/v1/career-library/${id}`).send({
      institutions: [{ name: "Test Norm College Two" }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.linkedInstitutions.map((i: { name: string }) => i.name)).toEqual(["Test Norm College Two"]);
    expect(updated.body.linkedCourses.map((c: { name: string }) => c.name)).toContain("Test Norm Course Keep");

    // Clearing with an empty array removes all links.
    const cleared = await authRequest(app).patch(`/api/v1/career-library/${id}`).send({ institutions: [] });
    expect(cleared.body.linkedInstitutions).toHaveLength(0);
  });

  it("400s an invalid link id and a by-name exam missing its level", async () => {
    const badId = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({ jobRole: "Test Norm Role Bad1", institutions: [{ id: "clzzzzzzzzzzzzzzzzzzzzzzzz" }] })
    );
    expect(badId.status).toBe(400);

    const noLevel = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({ jobRole: "Test Norm Role Bad2", entranceExams: [{ name: "Test Norm No Level" }] })
    );
    expect(noLevel.status).toBe(400);
  });

  it("403s a counsellor hitting the admin write path (dropdowns stay open)", async () => {
    const write = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", bearer("COUNSELLOR"))
      .send(entryBody({ jobRole: "Test Norm Role NoPerm" }));
    expect(write.status).toBe(403);

    const dropdown = await request(app)
      .get("/api/v1/career-library/courses")
      .set("Authorization", bearer("COUNSELLOR"));
    expect(dropdown.status).toBe(200);
  });
});
