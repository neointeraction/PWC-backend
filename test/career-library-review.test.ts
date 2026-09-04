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

  it("a counsellor's submission is DRAFT and hidden from the picker until approved", async () => {
    const submitted = await counsellor("/api/v1/career-library/entrance-exams").send({
      name: "Test Rev Exam",
      level: "UG",
      conductingBody: "Test Body",
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body).toMatchObject({ status: "DRAFT", submittedBy: "c-1" });

    // Default picker is ACTIVE-only, so it isn't offered yet...
    const picker = await authRequest(app).get("/api/v1/career-library/entrance-exams").query({ search: "Test Rev Exam" });
    expect(picker.body).toHaveLength(0);

    // ...but the admin review queue finds it.
    const queue = await authRequest(app)
      .get("/api/v1/career-library/entrance-exams")
      .query({ search: "Test Rev Exam", status: "DRAFT" });
    expect(queue.body).toHaveLength(1);

    const approved = await authRequest(app).post(`/api/v1/career-library/entrance-exams/${submitted.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("ACTIVE");

    const afterApproval = await authRequest(app)
      .get("/api/v1/career-library/entrance-exams")
      .query({ search: "Test Rev Exam" });
    expect(afterApproval.body).toHaveLength(1);

    // Re-reviewing an already-active row is a 409.
    const again = await authRequest(app).post(`/api/v1/career-library/entrance-exams/${submitted.body.id}/approve`);
    expect(again.status).toBe(409);
  });

  it("rejection hard-deletes the row, so re-proposing it creates a fresh one", async () => {
    const submitted = await counsellor("/api/v1/career-library/institutions").send({ name: "Test Rev College" });
    const rejected = await authRequest(app).post(`/api/v1/career-library/institutions/${submitted.body.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body).toEqual({ id: submitted.body.id, deleted: true });
    expect(await prisma.institution.findUnique({ where: { id: submitted.body.id } })).toBeNull();

    // Rejected rows stay out of the picker (there's nothing left to find).
    const picker = await authRequest(app).get("/api/v1/career-library/institutions").query({ search: "Test Rev College" });
    expect(picker.body).toHaveLength(0);

    // Re-proposing creates a brand-new row rather than reopening the deleted one.
    const reproposed = await counsellor("/api/v1/career-library/institutions").send({ name: "Test Rev College" });
    expect(reproposed.body.id).not.toBe(submitted.body.id);
    expect(reproposed.body).toMatchObject({ status: "DRAFT" });
    expect(await prisma.institution.count({ where: { name: "Test Rev College" } })).toBe(1);
  });

  it("an admin's own submission is active on the spot", async () => {
    const res = await authRequest(app)
      .post("/api/v1/career-library/courses")
      .send({ name: "Test Rev Course", level: "UG", durationYears: "3" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
  });

  it("an admin naming a draft row while adding a job role implicitly publishes it", async () => {
    const proposed = await counsellor("/api/v1/career-library/courses").send({ name: "Test Rev Pending Course" });
    expect(proposed.body.status).toBe("DRAFT");

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
    expect(row?.status).toBe("ACTIVE"); // linked by an admin => published
    expect(row?.id).toBe(proposed.body.id); // same row, not a duplicate

    // The entry surfaces each linked row's status so the UI can flag it.
    expect(entry.body.linkedCourses[0]).toHaveProperty("status", "ACTIVE");
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

  describe("Directly editing a canonical row (admin)", () => {
    it("edits an entrance exam's fields, 404s a missing id, and 403s a non-admin", async () => {
      const created = await authRequest(app)
        .post("/api/v1/career-library/entrance-exams")
        .send({ name: "Test Rev Edit Exam", level: "UG", conductingBody: "Old Body" });
      expect(created.status).toBe(201);

      const updated = await authRequest(app)
        .patch(`/api/v1/career-library/entrance-exams/${created.body.id}`)
        .send({ conductingBody: "New Body" });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ id: created.body.id, name: "Test Rev Edit Exam", conductingBody: "New Body" });

      const missing = await authRequest(app)
        .patch("/api/v1/career-library/entrance-exams/cknownid0000000000000000")
        .send({ conductingBody: "X" });
      expect(missing.status).toBe(404);

      const forbidden = await request(app)
        .patch(`/api/v1/career-library/entrance-exams/${created.body.id}`)
        .set("Authorization", bearer("COUNSELLOR"))
        .send({ conductingBody: "X" });
      expect(forbidden.status).toBe(403);
    });

    it("409s an entrance exam edit that clashes with another row's name+level", async () => {
      const a = await authRequest(app)
        .post("/api/v1/career-library/entrance-exams")
        .send({ name: "Test Rev Clash A", level: "UG" });
      await authRequest(app).post("/api/v1/career-library/entrance-exams").send({ name: "Test Rev Clash B", level: "UG" });

      const clash = await authRequest(app)
        .patch(`/api/v1/career-library/entrance-exams/${a.body.id}`)
        .send({ name: "Test Rev Clash B" });
      expect(clash.status).toBe(409);
    });

    it("edits a course and an institution row", async () => {
      const course = await authRequest(app)
        .post("/api/v1/career-library/courses")
        .send({ name: "Test Rev Edit Course", level: "UG" });
      const updatedCourse = await authRequest(app)
        .patch(`/api/v1/career-library/courses/${course.body.id}`)
        .send({ durationYears: "4" });
      expect(updatedCourse.status).toBe(200);
      expect(updatedCourse.body.durationYears).toBe("4");

      const institution = await authRequest(app)
        .post("/api/v1/career-library/institutions")
        .send({ name: "Test Rev Edit College" });
      const updatedInstitution = await authRequest(app)
        .patch(`/api/v1/career-library/institutions/${institution.body.id}`)
        .send({ city: "New City" });
      expect(updatedInstitution.status).toBe(200);
      expect(updatedInstitution.body.city).toBe("New City");
    });
  });
});
