import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

let domainId: string;
let otherDomainId: string;

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    domainId,
    jobRole: "Test Edu Role",
    aiResilienceGrade: "HIGH",
    aiResilienceComment: "x",
    oneLineDescription: "x",
    qualification10th12th: "Any",
    ...overrides,
  };
}

describe("Education Path (domain-level) + full-detail link items", () => {
  beforeAll(async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test Edu Cluster" } });
    const industry = await prisma.careerIndustry.create({
      data: { clusterId: cluster.id, name: "Test Edu Industry" },
    });
    const [a, b] = await Promise.all([
      prisma.careerDomain.create({ data: { industryId: industry.id, name: "Test Edu Domain A" } }),
      prisma.careerDomain.create({ data: { industryId: industry.id, name: "Test Edu Domain B" } }),
    ]);
    domainId = a.id;
    otherDomainId = b.id;
  });

  afterAll(async () => {
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: "Test Edu Role" } } });
    await prisma.domainEducationEntry.deleteMany({ where: { domain: { name: { startsWith: "Test Edu Domain" } } } });
    await prisma.careerDomain.deleteMany({ where: { name: { startsWith: "Test Edu Domain" } } });
    await prisma.careerIndustry.deleteMany({ where: { name: "Test Edu Industry" } });
    await prisma.careerCluster.deleteMany({ where: { name: "Test Edu Cluster" } });
    await prisma.entranceExam.deleteMany({ where: { name: { startsWith: "Test Edu " } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: "Test Edu " } } });
    await prisma.institution.deleteMany({ where: { name: { startsWith: "Test Edu " } } });
    await prisma.$disconnect();
  });

  // --- #3: Education Path CRUD ---

  it("CRUDs a domain's education path and enforces per-domain uniqueness", async () => {
    const created = await authRequest(app)
      .post(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .send({ level: "GRADUATE", programme: "B.Tech CSE", description: "4-year engineering degree" });
    expect(created.status).toBe(201);
    expect(created.body.domainId).toBe(domainId);
    const entryId = created.body.id;

    // Same programme at the same level in the same domain clashes...
    const dupe = await authRequest(app)
      .post(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .send({ level: "GRADUATE", programme: "B.Tech CSE" });
    expect(dupe.status).toBe(409);

    // ...but the same programme at a different level, or in another domain, is fine.
    const otherLevel = await authRequest(app)
      .post(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .send({ level: "POST_GRADUATE", programme: "B.Tech CSE" });
    expect(otherLevel.status).toBe(201);
    const otherDomain = await authRequest(app)
      .post(`/api/v1/career-taxonomy/domains/${otherDomainId}/education`)
      .send({ level: "GRADUATE", programme: "B.Tech CSE" });
    expect(otherDomain.status).toBe(201);

    // description: null clears it.
    const cleared = await authRequest(app)
      .patch(`/api/v1/career-taxonomy/education/${entryId}`)
      .send({ description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBeNull();

    // Listing is scoped to the domain and filterable by level.
    const list = await authRequest(app).get(`/api/v1/career-taxonomy/domains/${domainId}/education`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    const graduateOnly = await authRequest(app)
      .get(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .query({ level: "GRADUATE" });
    expect(graduateOnly.body.map((e: { programme: string }) => e.programme)).toEqual(["B.Tech CSE"]);

    // Soft delete drops it from the picker; restore brings it back.
    const deleted = await authRequest(app).delete(`/api/v1/career-taxonomy/education/${entryId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedAt).not.toBeNull();
    const afterDelete = await authRequest(app).get(`/api/v1/career-taxonomy/domains/${domainId}/education`);
    expect(afterDelete.body).toHaveLength(1);
    const withDeleted = await authRequest(app)
      .get(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .query({ includeDeleted: "true" });
    expect(withDeleted.body).toHaveLength(2);

    const restored = await authRequest(app).post(`/api/v1/career-taxonomy/education/${entryId}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();

    // 404 on an unknown domain / entry; 403 for a counsellor on the write path.
    expect((await authRequest(app).get("/api/v1/career-taxonomy/domains/nope/education")).status).toBe(404);
    expect((await authRequest(app).patch("/api/v1/career-taxonomy/education/nope").send({ programme: "x" })).status).toBe(404);
    // A counsellor may now propose an entry, but it lands PENDING and stays out of the
    // default tick-list until an admin approves it.
    const counsellorWrite = await request(app)
      .post(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .set("Authorization", bearer("COUNSELLOR", { userId: "counsellor-user-1" }))
      .send({ level: "GRADUATE", programme: "Test Edu Proposed" });
    expect(counsellorWrite.status).toBe(201);
    expect(counsellorWrite.body.status).toBe("PENDING");
    expect(counsellorWrite.body.submittedBy).toBe("counsellor-user-1");

    const pickerAfterProposal = await authRequest(app).get(`/api/v1/career-taxonomy/domains/${domainId}/education`);
    expect(pickerAfterProposal.body.map((e: { programme: string }) => e.programme)).not.toContain("Test Edu Proposed");

    // Reviewing it is admin-only.
    const counsellorApprove = await request(app)
      .post(`/api/v1/career-taxonomy/education/${counsellorWrite.body.id}/approve`)
      .set("Authorization", bearer("COUNSELLOR"));
    expect(counsellorApprove.status).toBe(403);
  });

  it("links education entries to a job role, writing new ones back to the domain", async () => {
    const existing = await authRequest(app)
      .post(`/api/v1/career-taxonomy/domains/${domainId}/education`)
      .send({ level: "CLASS_10_PLUS_2", programme: "PCM with Computer Science" });

    const created = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Links",
        educationEntries: [
          { id: existing.body.id },
          { level: "CERTIFICATION_UG", programme: "AWS Cloud Practitioner", description: "Entry-level cloud cert" },
        ],
      })
    );
    expect(created.status).toBe(201);
    const programmes = created.body.linkedEducationEntries.map((e: { programme: string }) => e.programme);
    expect(programmes).toContain("PCM with Computer Science");
    expect(programmes).toContain("AWS Cloud Practitioner");

    // The by-name entry was written back to the DOMAIN — a future role inherits it.
    const domainPath = await authRequest(app).get(`/api/v1/career-taxonomy/domains/${domainId}/education`);
    expect(domainPath.body.map((e: { programme: string }) => e.programme)).toContain("AWS Cloud Practitioner");

    // Re-using the same programme links the same row rather than duplicating it.
    await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Links Two",
        educationEntries: [{ level: "CERTIFICATION_UG", programme: "AWS Cloud Practitioner" }],
      })
    );
    const rows = await prisma.domainEducationEntry.findMany({
      where: { domainId, programme: "AWS Cloud Practitioner" },
    });
    expect(rows).toHaveLength(1);
  });

  it("rejects an education entry belonging to a different domain", async () => {
    const foreign = await authRequest(app)
      .post(`/api/v1/career-taxonomy/domains/${otherDomainId}/education`)
      .send({ level: "GRADUATE", programme: "Test Edu Foreign Programme" });

    const res = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({ jobRole: "Test Edu Role Foreign", educationEntries: [{ id: foreign.body.id }] })
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/different career domain/i);
  });

  // --- #1: full field set on inline "add new" link items ---

  it("persists the full detail set when adding an exam/course/college by name", async () => {
    const res = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Detail",
        entranceExams: [
          {
            name: "Test Edu Exam",
            level: "UG",
            fullForm: "Test Edu Entrance Examination",
            conductingBody: "Test Authority",
            officialWebsite: "www.test-edu-exam.in",
            examMode: "Computer-based (CBT)",
            frequency: "Twice a year",
            applicableFor: "B.Tech / B.E.",
            subjectRequirements12th: "Physics, Chemistry, Maths",
            applicationWindow: "Nov–Dec",
          },
        ],
        courses: [
          {
            name: "Test Edu Course",
            level: "UG",
            fullForm: "Bachelor of Test Engineering",
            durationYears: "4",
            stream12thRequirements: "Science (PCM)",
            relevantEntranceExams: "Test Edu Exam",
            programmesOffered: "Core, Honours",
            topColleges: "Test College A, Test College B",
            furtherStudyOptions: "M.Tech, MBA",
          },
        ],
        institutions: [
          {
            name: "Test Edu College",
            shortName: "TEC",
            city: "Pune",
            state: "Maharashtra",
            type: "Private",
            website: "www.test-edu-college.ac.in",
            entranceExamsRequired: "Test Edu Exam",
            programmesOffered: "B.Tech, M.Tech",
            ranking: "NIRF 42",
          },
        ],
      })
    );
    expect(res.status).toBe(201);

    const exam = await prisma.entranceExam.findFirst({ where: { name: "Test Edu Exam" } });
    expect(exam).toMatchObject({
      fullForm: "Test Edu Entrance Examination",
      conductingBody: "Test Authority",
      examMode: "Computer-based (CBT)",
      frequency: "Twice a year",
      applicableFor: "B.Tech / B.E.",
      subjectRequirements12th: "Physics, Chemistry, Maths",
      applicationWindow: "Nov–Dec",
    });

    const course = await prisma.course.findFirst({ where: { name: "Test Edu Course" } });
    expect(course).toMatchObject({
      durationYears: "4",
      stream12thRequirements: "Science (PCM)",
      relevantEntranceExams: "Test Edu Exam",
      programmesOffered: "Core, Honours",
      topColleges: "Test College A, Test College B",
      furtherStudyOptions: "M.Tech, MBA",
    });

    const inst = await prisma.institution.findFirst({ where: { name: "Test Edu College" } });
    expect(inst).toMatchObject({
      shortName: "TEC",
      city: "Pune",
      state: "Maharashtra",
      entranceExamsRequired: "Test Edu Exam",
      programmesOffered: "B.Tech, M.Tech",
      ranking: "NIRF 42",
    });
  });

  it("fills only BLANK columns on a canonical row that already exists", async () => {
    await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Blank A",
        institutions: [{ name: "Test Edu Shared College", city: "Pune", ranking: "NIRF 42" }],
      })
    );

    // A second role links the same college with a different city (should NOT overwrite)
    // and a ranking-adjacent blank column (should fill).
    await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Blank B",
        institutions: [
          { name: "Test Edu Shared College", city: "Mumbai", state: "Maharashtra", ranking: "NIRF 1" },
        ],
      })
    );

    const inst = await prisma.institution.findFirst({ where: { name: "Test Edu Shared College" } });
    expect(inst?.city).toBe("Pune"); // existing value preserved
    expect(inst?.ranking).toBe("NIRF 42"); // existing value preserved
    expect(inst?.state).toBe("Maharashtra"); // blank column filled in
  });
});
