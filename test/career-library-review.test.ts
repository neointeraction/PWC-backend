import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const counsellor = (url: string) => request(app).post(url).set("Authorization", bearer("COUNSELLOR", { userId: "c-1" }));

let domainId: string;

describe("Reference data review (counsellor proposes, admin approves/rejects)", () => {
  beforeAll(async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test Rev Cluster" } });
    const industry = await prisma.careerIndustry.create({ data: { clusterId: cluster.id, name: "Test Rev Industry" } });
    const domain = await prisma.careerDomain.create({ data: { industryId: industry.id, name: "Test Rev Domain" } });
    domainId = domain.id;
  });

  afterAll(async () => {
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: "Test Rev Role" } } });
    await prisma.educationEntry.deleteMany({ where: { programme: { startsWith: "Test Rev " } } });
    await prisma.careerDomain.deleteMany({ where: { name: "Test Rev Domain" } });
    await prisma.careerIndustry.deleteMany({ where: { name: "Test Rev Industry" } });
    await prisma.careerCluster.deleteMany({ where: { name: "Test Rev Cluster" } });
    await prisma.entranceExam.deleteMany({ where: { name: { startsWith: "Test Rev " } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: "Test Rev " } } });
    await prisma.institution.deleteMany({ where: { name: { startsWith: "Test Rev " } } });
    await prisma.$disconnect();
  });

  it("a counsellor's submission is PENDING and hidden from the picker until approved", async () => {
    const submitted = await counsellor("/api/v1/career-library/entrance-exams").send({
      name: "Test Rev Exam",
      level: "UG",
      conductingBody: "Test Body",
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body).toMatchObject({ status: "PENDING", submittedBy: "c-1" });
    expect(submitted.body.reviewedAt).toBeNull();

    // Default picker is APPROVED-only, so it isn't offered yet...
    const picker = await authRequest(app).get("/api/v1/career-library/entrance-exams").query({ search: "Test Rev Exam" });
    expect(picker.body).toHaveLength(0);

    // ...but the admin review queue finds it.
    const queue = await authRequest(app)
      .get("/api/v1/career-library/entrance-exams")
      .query({ search: "Test Rev Exam", status: "PENDING" });
    expect(queue.body).toHaveLength(1);

    const approved = await authRequest(app).post(`/api/v1/career-library/entrance-exams/${submitted.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
    expect(approved.body.reviewedAt).not.toBeNull();

    const afterApproval = await authRequest(app)
      .get("/api/v1/career-library/entrance-exams")
      .query({ search: "Test Rev Exam" });
    expect(afterApproval.body).toHaveLength(1);

    // Re-reviewing a decided row is a stale-queue 409.
    const again = await authRequest(app).post(`/api/v1/career-library/entrance-exams/${submitted.body.id}/approve`);
    expect(again.status).toBe(409);
  });

  it("rejection keeps the reason, and a counsellor re-proposing it reopens review", async () => {
    const submitted = await counsellor("/api/v1/career-library/institutions").send({ name: "Test Rev College" });
    const rejected = await authRequest(app)
      .post(`/api/v1/career-library/institutions/${submitted.body.id}/reject`)
      .send({ rejectionReason: "Not a recognised institution" });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ status: "REJECTED", rejectionReason: "Not a recognised institution" });

    // Rejected rows stay out of the picker.
    const picker = await authRequest(app).get("/api/v1/career-library/institutions").query({ search: "Test Rev College" });
    expect(picker.body).toHaveLength(0);

    // Re-proposing reopens the same row rather than creating a duplicate.
    const reproposed = await counsellor("/api/v1/career-library/institutions").send({ name: "Test Rev College" });
    expect(reproposed.body.id).toBe(submitted.body.id);
    expect(reproposed.body).toMatchObject({ status: "PENDING", rejectionReason: null });
    expect(await prisma.institution.count({ where: { name: "Test Rev College" } })).toBe(1);
  });

  it("an admin's own submission is approved on the spot", async () => {
    const res = await authRequest(app)
      .post("/api/v1/career-library/courses")
      .send({ name: "Test Rev Course", level: "UG", durationYears: "3" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.reviewedBy).not.toBeNull();
  });

  it("an admin naming a pending row while adding a job role implicitly approves it", async () => {
    const proposed = await counsellor("/api/v1/career-library/courses").send({ name: "Test Rev Pending Course" });
    expect(proposed.body.status).toBe("PENDING");

    const entry = await authRequest(app).post("/api/v1/career-library").send({
      domainId,
      jobRole: "Test Rev Role",
      aiResilienceGrade: "HIGH",
      aiResilienceComment: "x",
      oneLineDescription: "x",
      qualification10th12th: "Any",
      courses: [{ name: "Test Rev Pending Course", level: "UG" }],
      status: "ACTIVE",
    });
    expect(entry.status).toBe(201);

    const row = await prisma.course.findFirst({ where: { name: "Test Rev Pending Course" } });
    expect(row?.status).toBe("APPROVED"); // linked by an admin => approved
    expect(row?.id).toBe(proposed.body.id); // same row, not a duplicate

    // The entry surfaces each linked row's review state so the UI can flag it.
    expect(entry.body.linkedCourses[0]).toHaveProperty("status", "APPROVED");
  });

  it("students cannot propose reference data; counsellors cannot review it", async () => {
    const student = await request(app)
      .post("/api/v1/career-library/institutions")
      .set("Authorization", bearer("STUDENT"))
      .send({ name: "Test Rev Student College" });
    expect(student.status).toBe(403);

    const proposed = await counsellor("/api/v1/career-library/institutions").send({ name: "Test Rev Review Guard" });
    const counsellorApprove = await request(app)
      .post(`/api/v1/career-library/institutions/${proposed.body.id}/approve`)
      .set("Authorization", bearer("COUNSELLOR"));
    expect(counsellorApprove.status).toBe(403);
  });
});
