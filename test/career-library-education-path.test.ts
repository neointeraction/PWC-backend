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

describe("Education Path (global lookup) + full-detail link items", () => {
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
    await prisma.educationEntry.deleteMany({ where: { programme: { startsWith: "Test Edu " } } });
    await prisma.careerDomain.deleteMany({ where: { name: { startsWith: "Test Edu Domain" } } });
    await prisma.careerIndustry.deleteMany({ where: { name: "Test Edu Industry" } });
    await prisma.careerCluster.deleteMany({ where: { name: "Test Edu Cluster" } });
    await prisma.entranceExam.deleteMany({ where: { name: { startsWith: "Test Edu " } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: "Test Edu " } } });
    await prisma.institution.deleteMany({ where: { name: { startsWith: "Test Edu " } } });
    await prisma.$disconnect();
  });

  // --- #3: Education Path CRUD ---

  it("CRUDs education entries and enforces uniqueness globally, not per domain", async () => {
    const created = await authRequest(app)
      .post("/api/v1/career-library/education")
      .send({ level: "GRADUATE", programme: "Test Edu B.Tech CSE", description: "4-year engineering degree" });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("domainId"); // entries are global now
    const entryId = created.body.id;

    // Same programme at the same level clashes — anywhere, not just within one domain.
    const dupe = await authRequest(app)
      .post("/api/v1/career-library/education")
      .send({ level: "GRADUATE", programme: "Test Edu B.Tech CSE" });
    expect(dupe.status).toBe(409);

    // The same programme at a different level is still a distinct row.
    const otherLevel = await authRequest(app)
      .post("/api/v1/career-library/education")
      .send({ level: "POST_GRADUATE", programme: "Test Edu B.Tech CSE" });
    expect(otherLevel.status).toBe(201);

    // description: null clears it.
    const cleared = await authRequest(app)
      .patch(`/api/v1/career-library/education/${entryId}`)
      .send({ description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBeNull();

    // Listing is global, searchable and filterable by level.
    const list = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu B.Tech CSE" });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    const graduateOnly = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu B.Tech CSE", level: "GRADUATE" });
    expect(graduateOnly.body.map((e: { programme: string }) => e.programme)).toEqual(["Test Edu B.Tech CSE"]);

    // Delete is permanent now - the row is gone, not hidden.
    const deleted = await authRequest(app).delete(`/api/v1/career-library/education/${entryId}`);
    expect(deleted.status).toBe(200);
    const afterDelete = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu B.Tech CSE" });
    expect(afterDelete.body).toHaveLength(1);
    expect((await authRequest(app).delete(`/api/v1/career-library/education/${entryId}`)).status).toBe(404);

    // 404 on an unknown entry; 400 on a domainId filter that isn't a live domain.
    expect((await authRequest(app).patch("/api/v1/career-library/education/nope").send({ programme: "x" })).status).toBe(404);
    expect((await authRequest(app).get("/api/v1/career-library/education").query({ domainId: "nope" })).status).toBe(400);
  });

  it("a counsellor's entry lands DRAFT; publishing it to ACTIVE is the admin's step", async () => {
    const proposed = await request(app)
      .post("/api/v1/career-library/education")
      .set("Authorization", bearer("COUNSELLOR", { userId: "counsellor-user-1" }))
      .send({ level: "GRADUATE", programme: "Test Edu Proposed" });
    expect(proposed.status).toBe(201);
    expect(proposed.body.status).toBe("DRAFT");
    expect(proposed.body.submittedBy).toBe("counsellor-user-1");

    // The default picker is ACTIVE-only, so a DRAFT entry isn't offered...
    const picker = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu Proposed" });
    expect(picker.body).toHaveLength(0);
    // ...but ?status=DRAFT finds it for review.
    const drafts = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu Proposed", status: "DRAFT" });
    expect(drafts.body).toHaveLength(1);

    // Publishing is a plain PATCH, and it's admin-only.
    const byCounsellor = await request(app)
      .patch(`/api/v1/career-library/education/${proposed.body.id}`)
      .set("Authorization", bearer("COUNSELLOR"))
      .send({ status: "ACTIVE" });
    expect(byCounsellor.status).toBe(403);

    const published = await authRequest(app)
      .patch(`/api/v1/career-library/education/${proposed.body.id}`)
      .send({ status: "ACTIVE" });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("ACTIVE");

    const afterPublish = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu Proposed" });
    expect(afterPublish.body).toHaveLength(1);
  });

  it("approves and rejects a counsellor's proposed education entry", async () => {
    const propose = (programme: string) =>
      request(app)
        .post("/api/v1/career-library/education")
        .set("Authorization", bearer("COUNSELLOR", { userId: "counsellor-user-1" }))
        .send({ level: "GRADUATE", programme });

    // Approve publishes it into the picker.
    const ok = await propose("Test Edu Approved Prog");
    const approved = await authRequest(app).post(`/api/v1/career-library/education/${ok.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("ACTIVE");
    const picker = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu Approved Prog" });
    expect(picker.body).toHaveLength(1);
    // Already published — the admin is on a stale queue.
    expect((await authRequest(app).post(`/api/v1/career-library/education/${ok.body.id}/approve`)).status).toBe(409);

    // Reject deletes the row outright.
    const doomed = await propose("Test Edu Rejected Prog");
    const rejected = await authRequest(app).post(`/api/v1/career-library/education/${doomed.body.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body).toEqual({ id: doomed.body.id, deleted: true });
    expect(await prisma.educationEntry.findUnique({ where: { id: doomed.body.id } })).toBeNull();

    // Review is admin-only, and unknown ids 404.
    const self = await propose("Test Edu SelfApprove Prog");
    const byCounsellor = await request(app)
      .post(`/api/v1/career-library/education/${self.body.id}/approve`)
      .set("Authorization", bearer("COUNSELLOR", { userId: "counsellor-user-1" }));
    expect(byCounsellor.status).toBe(403);
    expect((await authRequest(app).post("/api/v1/career-library/education/nope/reject")).status).toBe(404);
  });

  it("refuses to reject an education entry that job roles already link to", async () => {
    const proposed = await request(app)
      .post("/api/v1/career-library/education")
      .set("Authorization", bearer("COUNSELLOR", { userId: "counsellor-user-1" }))
      .send({ level: "GRADUATE", programme: "Test Edu Linked Prog" });

    // Link it to a job role, then try to reject it — the join rows would cascade away.
    await authRequest(app)
      .post("/api/v1/career-library")
      .send(entryBody({ jobRole: "Test Edu Role Linked", educationEntries: [{ id: proposed.body.id }] }));

    const rejected = await authRequest(app).post(`/api/v1/career-library/education/${proposed.body.id}/reject`);
    expect(rejected.status).toBe(409);
    expect(await prisma.educationEntry.findUnique({ where: { id: proposed.body.id } })).not.toBeNull();
  });

  it("an admin adding an entry publishes it straight to ACTIVE, with a description", async () => {
    const created = await authRequest(app)
      .post("/api/v1/career-library/education")
      .send({
        level: "POST_GRADUATE",
        programme: "Test Edu MSc Something",
        description: "A relevant Master's building on the UG degree.",
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("ACTIVE");
    expect(created.body.description).toBe("A relevant Master's building on the UG degree.");
  });

  it("links education entries to a job role and reuses one global row across roles", async () => {
    const existing = await authRequest(app)
      .post("/api/v1/career-library/education")
      .send({ level: "CLASS_10_PLUS_2", programme: "Test Edu PCM with Computer Science" });

    const created = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Links",
        educationEntries: [
          { id: existing.body.id },
          { level: "CERTIFICATION_UG", programme: "Test Edu AWS Cloud Practitioner", description: "Entry-level cloud cert" },
        ],
      })
    );
    expect(created.status).toBe(201);
    const programmes = created.body.linkedEducationEntries.map((e: { programme: string }) => e.programme);
    expect(programmes).toContain("Test Edu PCM with Computer Science");
    expect(programmes).toContain("Test Edu AWS Cloud Practitioner");

    // The picker can still be scoped to a domain — by USAGE (entries linked to roles in
    // that domain), not ownership. The entry now shows for domain A and not for domain B.
    const inDomainA = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu AWS", domainId });
    expect(inDomainA.body.map((e: { programme: string }) => e.programme)).toContain("Test Edu AWS Cloud Practitioner");
    const inDomainB = await authRequest(app)
      .get("/api/v1/career-library/education")
      .query({ search: "Test Edu AWS", domainId: otherDomainId });
    expect(inDomainB.body).toHaveLength(0);

    // A role in a DIFFERENT domain reuses the same row rather than duplicating it —
    // this is the whole point of unlinking entries from the taxonomy.
    await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Links Two",
        domainId: otherDomainId,
        educationEntries: [{ level: "CERTIFICATION_UG", programme: "Test Edu AWS Cloud Practitioner" }],
      })
    );
    const rows = await prisma.educationEntry.findMany({
      where: { programme: "Test Edu AWS Cloud Practitioner" },
    });
    expect(rows).toHaveLength(1);
  });

  it("links an entry to a job role in any domain", async () => {
    const entry = await authRequest(app)
      .post("/api/v1/career-library/education")
      .send({ level: "GRADUATE", programme: "Test Edu Cross Domain Programme" });

    // Created independently of any domain, then attached to a role in domain B.
    const res = await authRequest(app).post("/api/v1/career-library").send(
      entryBody({
        jobRole: "Test Edu Role Cross",
        domainId: otherDomainId,
        educationEntries: [{ id: entry.body.id }],
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.linkedEducationEntries.map((e: { programme: string }) => e.programme)).toContain(
      "Test Edu Cross Domain Programme"
    );
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
