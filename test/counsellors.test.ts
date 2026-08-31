import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

let instituteId: string;
let otherInstituteId: string;
let projectId: string;
let otherProjectId: string;
let divisionId: string;

describe("Counsellors API", () => {
  beforeAll(async () => {
    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Counsellors",
      address: "1 CN St",
      contactNumber: "+919876572001",
      primaryEmail: "counsellors@test-institute.example",
    });
    instituteId = institute.body.id;

    const other = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Counsellors Other",
      address: "2 CN St",
      contactNumber: "+919876572002",
      primaryEmail: "counsellors-other@test-institute.example",
    });
    otherInstituteId = other.body.id;

    const project = await prisma.project.create({
      data: { instituteId, name: "Test Project Counsellors", fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31") },
    });
    projectId = project.id;
    const otherProject = await prisma.project.create({
      data: { instituteId: otherInstituteId, name: "Test Project Counsellors Other", fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31") },
    });
    otherProjectId = otherProject.id;

    const klass = await authRequest(app).post(`/api/v1/institutes/${instituteId}/classes`).send({ name: "Grade 9" });
    const division = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "A" });
    divisionId = division.body.id;
  });

  afterAll(async () => {
    // Sessions RESTRICT the counsellor delete cascade — remove the directly-inserted one first.
    await prisma.session.deleteMany({ where: { counsellor: { institute: { name: { startsWith: "Test Institute Counsellors" } } } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@test-counsellor.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project Counsellors" } } });
    await prisma.institute.deleteMany({ where: { name: { startsWith: "Test Institute Counsellors" } } });
    await prisma.$disconnect();
  });

  it("creates a counsellor with a linked user and returns a temp password", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Cyrus",
      lastName: "Nair",
      email: "cyrus@test-counsellor.example",
      mobile: "+919876572010",
      counsellorCode: "CN1",
      instituteId,
      projectIds: [projectId],
    });
    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeTypeOf("string");
    expect(res.body.counsellor.user).toMatchObject({ email: "cyrus@test-counsellor.example" });
    expect(res.body.counsellor.institute.id).toBe(instituteId);
    expect(res.body.counsellor.projects).toHaveLength(1);
    expect(res.body.counsellor.projects[0].projectId).toBe(projectId);
  });

  it("auto-generates a counsellorCode (C####) when none is supplied", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Auto",
      lastName: "Counsellor",
      email: "auto@test-counsellor.example",
      mobile: "+919876572077",
      instituteId,
    });
    expect(res.status).toBe(201);
    expect(res.body.counsellor.counsellorCode).toMatch(/^C\d{4,}$/);
  });

  it("rejects a duplicate counsellorCode with 409", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Dup",
      lastName: "Code",
      email: "dupcode@test-counsellor.example",
      mobile: "+919876572011",
      counsellorCode: "CN1", // same as above
      instituteId,
    });
    expect(res.status).toBe(409);
  });

  it("creates a counsellor with no instituteId (unassigned pool) and assigns it to projects across institutes", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Pool",
      lastName: "Counsellor",
      email: "pool@test-counsellor.example",
      mobile: "+919876572040",
      counsellorCode: "CN-POOL",
    });
    expect(res.status).toBe(201);
    expect(res.body.counsellor.institute).toBeNull();
    const id = res.body.counsellor.id;

    const assign = await authRequest(app).post(`/api/v1/counsellors/${id}/projects`).send({ projectId });
    expect(assign.status).toBe(200);
    // instituteId is informational only and is never backfilled by assignment.
    expect(assign.body.institute).toBeNull();

    // Counsellors are tenant-wide, not institute-scoped: assignment to a project under a
    // different institute succeeds too, and both assignments coexist.
    const otherAssign = await authRequest(app).post(`/api/v1/counsellors/${id}/projects`).send({ projectId: otherProjectId });
    expect(otherAssign.status).toBe(200);
    expect(otherAssign.body.projects.map((p: { projectId: string }) => p.projectId).sort()).toEqual(
      [projectId, otherProjectId].sort()
    );
  });

  it("allows projectIds on creation without instituteId", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Bad",
      lastName: "NoInstitute",
      email: "badnoinstitute@test-counsellor.example",
      mobile: "+919876572041",
      counsellorCode: "CN-BAD",
      projectIds: [projectId],
    });
    expect(res.status).toBe(201);
  });

  it("allows a projectId from a different institute than instituteId on creation", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Bad",
      lastName: "Project",
      email: "badproject@test-counsellor.example",
      mobile: "+919876572012",
      counsellorCode: "CN2",
      instituteId,
      projectIds: [otherProjectId],
    });
    expect(res.status).toBe(201);
  });

  it("lists counsellors, filterable by project", async () => {
    const all = await authRequest(app).get("/api/v1/counsellors").query({ instituteId });
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(0);

    const byProject = await authRequest(app).get("/api/v1/counsellors").query({ projectId });
    expect(byProject.status).toBe(200);
    expect(byProject.body.every((c: { projects: { projectId: string }[] }) => c.projects.some((p) => p.projectId === projectId))).toBe(true);
  });

  it("gets, updates, and 404s an unknown counsellor", async () => {
    const created = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Uma",
      lastName: "Rao",
      email: "uma@test-counsellor.example",
      mobile: "+919876572013",
      counsellorCode: "CN3",
      instituteId,
    });
    const id = created.body.counsellor.id;

    const got = await authRequest(app).get(`/api/v1/counsellors/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.user.firstName).toBe("Uma");

    const updated = await authRequest(app).patch(`/api/v1/counsellors/${id}`).send({ firstName: "Uma B", mobile: "+919876572099", isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.user.firstName).toBe("Uma B");
    expect(updated.body.user.isActive).toBe(false);
    expect(updated.body.mobile).toBe("+919876572099");

    const missing = await authRequest(app).get("/api/v1/counsellors/clzzzzzzzzzzzzzzzzzzzzzzzz");
    expect(missing.status).toBe(404);
  });

  it("assigns and unassigns a project", async () => {
    const created = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Assign",
      lastName: "Me",
      email: "assign@test-counsellor.example",
      mobile: "+919876572014",
      counsellorCode: "CN4",
      instituteId,
    });
    const id = created.body.counsellor.id;

    const assign = await authRequest(app).post(`/api/v1/counsellors/${id}/projects`).send({ projectId });
    expect(assign.status).toBe(200);
    expect(assign.body.projects.some((p: { projectId: string }) => p.projectId === projectId)).toBe(true);

    const dup = await authRequest(app).post(`/api/v1/counsellors/${id}/projects`).send({ projectId });
    expect(dup.status).toBe(409); // already assigned

    const unassign = await authRequest(app).delete(`/api/v1/counsellors/${id}/projects/${projectId}`);
    expect(unassign.status).toBe(200);
    expect(unassign.body.projects.some((p: { projectId: string }) => p.projectId === projectId)).toBe(false);

    const unassignAgain = await authRequest(app).delete(`/api/v1/counsellors/${id}/projects/${projectId}`);
    expect(unassignAgain.status).toBe(404); // not assigned anymore
  });

  it("deletes a counsellor with no sessions", async () => {
    const created = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Delete",
      lastName: "Me",
      email: "deleteme@test-counsellor.example",
      mobile: "+919876572015",
      counsellorCode: "CN5",
      instituteId,
    });
    const id = created.body.counsellor.id;

    const del = await authRequest(app).delete(`/api/v1/counsellors/${id}`);
    expect(del.status).toBe(204);

    const got = await authRequest(app).get(`/api/v1/counsellors/${id}`);
    expect(got.status).toBe(404);
  });

  it("409s deleting a counsellor that has sessions (deactivate instead)", async () => {
    const created = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Busy",
      lastName: "Counsellor",
      email: "busy@test-counsellor.example",
      mobile: "+919876572016",
      counsellorCode: "CN6",
      instituteId,
    });
    const id = created.body.counsellor.id;

    // A student + a session directly on this counsellor (bypassing the booking flow).
    const student = await authRequest(app).post("/api/v1/students").send({
      firstName: "Sess",
      lastName: "Student",
      email: "sess@test-counsellor.example",
      mobile: "+919876572017",
      studentCode: "CNS1",
      projectId,
      divisionId,
      parentMobile: "+919876572018",
      parentEmail: "parent-sess@test-counsellor.example",
      fatherName: "F",
      fatherOccupation: "Engineer",
      motherName: "M",
      motherOccupation: "Doctor",
    });
    await prisma.session.create({
      data: {
        studentId: student.body.student.id,
        counsellorId: id,
        sessionNumber: "SESSION_1",
        scheduledDate: new Date("2026-06-01"),
        startTime: "10:00",
        endTime: "10:45",
      },
    });

    const del = await authRequest(app).delete(`/api/v1/counsellors/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.details.sessionCount).toBe(1);
  });

  it("enforces auth: 401 without token, 403 for a counsellor creating (admin-only)", async () => {
    const noToken = await request(app).get("/api/v1/counsellors");
    expect(noToken.status).toBe(401);

    const asCounsellor = await request(app)
      .post("/api/v1/counsellors")
      .set("Authorization", bearer("COUNSELLOR"))
      .send({ firstName: "X", lastName: "Y", email: "x@test-counsellor.example", mobile: "+919876572030", counsellorCode: "CN9", instituteId });
    expect(asCounsellor.status).toBe(403);
  });
});
