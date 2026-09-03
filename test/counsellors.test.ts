import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

let projectId: string;
let otherProjectId: string;

describe("Counsellors API", () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        code: "P-CN",
        name: "Test Project Counsellors",
        address: "1 CN St",
        contactNumber: "+919876572001",
        primaryEmail: "counsellors@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;
    const otherProject = await prisma.project.create({
      data: {
        code: "P-CN-OTHER",
        name: "Test Project Counsellors Other",
        address: "2 CN St",
        contactNumber: "+919876572002",
        primaryEmail: "counsellors-other@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    otherProjectId = otherProject.id;
  });

  afterAll(async () => {
    // Sessions RESTRICT the counsellor delete cascade — remove the directly-inserted one first.
    await prisma.session.deleteMany({ where: { student: { project: { name: { startsWith: "Test Project Counsellors" } } } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@test-counsellor.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project Counsellors" } } });
    await prisma.$disconnect();
  });

  it("creates a counsellor with a linked user and returns a temp password", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Cyrus",
      lastName: "Nair",
      email: "cyrus@test-counsellor.example",
      mobile: "+919876572010",
      counsellorCode: "CN1",
      projectIds: [projectId],
    });
    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeTypeOf("string");
    expect(res.body.counsellor.user).toMatchObject({ email: "cyrus@test-counsellor.example" });
    expect(res.body.counsellor.projects).toHaveLength(1);
    expect(res.body.counsellor.projects[0].projectId).toBe(projectId);
  });

  it("rejects a missing counsellorCode with 400 (no auto-generation)", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "NoCode",
      lastName: "Counsellor",
      email: "nocode@test-counsellor.example",
      mobile: "+919876572077",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate counsellorCode with 409", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Dup",
      lastName: "Code",
      email: "dupcode@test-counsellor.example",
      mobile: "+919876572011",
      counsellorCode: "CN1", // same as above
    });
    expect(res.status).toBe(409);
  });

  it("assigns a newly created counsellor to projects across projects freely (counsellors are tenant-wide)", async () => {
    const res = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Pool",
      lastName: "Counsellor",
      email: "pool@test-counsellor.example",
      mobile: "+919876572040",
      counsellorCode: "CN-POOL",
    });
    expect(res.status).toBe(201);
    const id = res.body.counsellor.id;

    const assign = await authRequest(app).post(`/api/v1/counsellors/${id}/projects`).send({ projectId });
    expect(assign.status).toBe(200);

    // Assignment to a different project succeeds too, and both assignments coexist.
    const otherAssign = await authRequest(app).post(`/api/v1/counsellors/${id}/projects`).send({ projectId: otherProjectId });
    expect(otherAssign.status).toBe(200);
    expect(otherAssign.body.projects.map((p: { projectId: string }) => p.projectId).sort()).toEqual(
      [projectId, otherProjectId].sort()
    );
  });

  it("allows projectIds on creation", async () => {
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

  it("lists counsellors, filterable by project", async () => {
    const all = await authRequest(app).get("/api/v1/counsellors");
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
      className: "Grade 9",
      divisionName: "A",
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

  it("sets, updates, and clears the default meetingLink", async () => {
    const created = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Link",
      lastName: "Bearer",
      email: "linkbearer@test-counsellor.example",
      mobile: "+919876572060",
      counsellorCode: "CN-LINK",
      meetingLink: "https://meet.example.com/link-bearer",
    });
    expect(created.status).toBe(201);
    expect(created.body.counsellor.meetingLink).toBe("https://meet.example.com/link-bearer");
    const id = created.body.counsellor.id;

    const updated = await authRequest(app)
      .patch(`/api/v1/counsellors/${id}`)
      .send({ meetingLink: "https://meet.example.com/link-bearer-2" });
    expect(updated.status).toBe(200);
    expect(updated.body.meetingLink).toBe("https://meet.example.com/link-bearer-2");

    const cleared = await authRequest(app).patch(`/api/v1/counsellors/${id}`).send({ meetingLink: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.meetingLink).toBeNull();
  });

  it("GET /counsellors/me resolves the logged-in counsellor's own record", async () => {
    const created = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Self",
      lastName: "Service",
      email: "selfservice@test-counsellor.example",
      mobile: "+919876572050",
      counsellorCode: "CN-ME",
    });
    const userId = created.body.counsellor.user.id;

    const me = await request(app)
      .get("/api/v1/counsellors/me")
      .set("Authorization", bearer("COUNSELLOR", { userId }));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(created.body.counsellor.id);
    expect(me.body.user.email).toBe("selfservice@test-counsellor.example");
  });

  it("GET /counsellors/me 404s for an account with no linked Counsellor row", async () => {
    const me = await request(app)
      .get("/api/v1/counsellors/me")
      .set("Authorization", bearer("ADMIN"));
    expect(me.status).toBe(404);
  });

  it("enforces auth: 401 without token, 403 for a counsellor creating (admin-only)", async () => {
    const noToken = await request(app).get("/api/v1/counsellors");
    expect(noToken.status).toBe(401);

    const asCounsellor = await request(app)
      .post("/api/v1/counsellors")
      .set("Authorization", bearer("COUNSELLOR"))
      .send({ firstName: "X", lastName: "Y", email: "x@test-counsellor.example", mobile: "+919876572030", counsellorCode: "CN9" });
    expect(asCounsellor.status).toBe(403);
  });
});
