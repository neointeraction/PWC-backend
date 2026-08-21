import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

let instituteId: string;
let projectId: string;
let divisionId: string;
let otherProjectId: string;

describe("Students API", () => {
  beforeAll(async () => {
    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Students",
      address: "1 Student St",
      contactNumber: "+919876540001",
      primaryEmail: "students@test-institute.example",
    });
    instituteId = institute.body.id;

    const otherInstitute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Students Other",
      address: "2 Student St",
      contactNumber: "+919876540002",
      primaryEmail: "students-other@test-institute.example",
    });
    const otherInstituteId = otherInstitute.body.id;

    // No Projects module/routes yet — create directly via Prisma for this test setup.
    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Students",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;

    const otherProject = await prisma.project.create({
      data: {
        instituteId: otherInstituteId,
        name: "Test Project Students Other",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    otherProjectId = otherProject.id;

    const klass = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes`)
      .send({ name: "Grade 9" });

    const division = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "A" });
    divisionId = division.body.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-student.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project Students" } } });
    await prisma.institute.deleteMany({
      where: { name: { startsWith: "Test Institute Students" } },
    });
    await prisma.$disconnect();
  });

  it("creates a student with a linked user and returns a temp password", async () => {
    const res = await authRequest(app).post("/api/v1/students").send({
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@test-student.example",
      mobile: "+919876500001",
      studentCode: "CB1",
      projectId,
      divisionId,
      parentMobile: "+919876500002",
      parentEmail: "parent-asha@test-student.example",
      fatherName: "Rao Sr",
      fatherOccupation: "Engineer",
      motherName: "Rao Jr",
      motherOccupation: "Doctor",
    });

    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeTypeOf("string");
    expect(res.body.student.user).toMatchObject({ email: "asha@test-student.example" });
    expect(res.body.student.division.id).toBe(divisionId);
  });

  it("auto-generates a studentCode (S####) when none is supplied", async () => {
    const res = await authRequest(app).post("/api/v1/students").send({
      firstName: "Auto",
      lastName: "Code",
      email: "autocode@test-student.example",
      mobile: "+919876500051",
      projectId,
      divisionId,
      parentMobile: "+919876500052",
      parentEmail: "parent-autocode@test-student.example",
      fatherName: "Code Sr",
    });

    expect(res.status).toBe(201);
    expect(res.body.student.studentCode).toMatch(/^S\d{4,}$/);
  });

  it("lets a student fetch their own record via /students/me and confirm their profile", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Self",
      lastName: "Service",
      email: "self@test-student.example",
      mobile: "+919876500061",
      projectId,
      divisionId,
      parentMobile: "+919876500062",
      parentEmail: "parent-self@test-student.example",
      fatherName: "Service Sr",
    });
    expect(created.status).toBe(201);
    const studentId: string = created.body.student.id;
    const userId: string = created.body.student.user.id;

    // The student's own token (sub = their User.id).
    const asStudent = authRequest(app, "STUDENT", { userId });

    const me = await asStudent.get("/api/v1/students/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(studentId);
    expect(me.body.studentCode).toMatch(/^S\d{4,}$/);
    expect(me.body.workflowStatus).toBe("DRAFT");
    // Cohort surfaced for the frontend to request the right form/assessment bank.
    expect(me.body).toHaveProperty("cohort");

    // Student confirms their own profile → workflow advances.
    const confirm = await asStudent.post(`/api/v1/students/${studentId}/confirm-profile`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.workflowStatus).toBe("PROFILE_COMPLETED");
  });

  it("stops a student from confirming another student's profile", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Victim",
      lastName: "Student",
      email: "victim@test-student.example",
      mobile: "+919876500071",
      projectId,
      divisionId,
      parentMobile: "+919876500072",
      parentEmail: "parent-victim@test-student.example",
      fatherName: "Victim Sr",
    });
    const victimId: string = created.body.student.id;

    // A different student (arbitrary userId not matching victim's).
    const asOther = authRequest(app, "STUDENT", { userId: "some-other-user-id" });
    const res = await asOther.post(`/api/v1/students/${victimId}/confirm-profile`);
    expect(res.status).toBe(403);
  });

  it("404s /students/me for a non-student account", async () => {
    const res = await authRequest(app, "COUNSELLOR", { userId: "staff-no-student" }).get(
      "/api/v1/students/me"
    );
    expect(res.status).toBe(404);
  });

  it("returns stageInfo on list rows and filters by flagged / stage", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Idle",
      lastName: "Student",
      email: "idle@test-student.example",
      mobile: "+919876500081",
      projectId,
      divisionId,
      parentMobile: "+919876500082",
      parentEmail: "parent-idle@test-student.example",
      fatherName: "Idle Sr",
    });
    const studentId: string = created.body.student.id;

    // Freshly created (DRAFT, today) → Login Activated, not yet flagged.
    const fresh = await authRequest(app).get(`/api/v1/students?projectId=${projectId}`);
    const freshRow = fresh.body.find((s: { id: string }) => s.id === studentId);
    expect(freshRow.stageInfo).toMatchObject({ stage: "LOGIN_ACTIVATED", flagged: false });
    expect(freshRow.stageInfo.ageDays).toBe(0);

    // Backdate creation 5 days → now idle beyond the 2-day threshold.
    await prisma.student.update({
      where: { id: studentId },
      data: { createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });

    const flagged = await authRequest(app).get(`/api/v1/students?projectId=${projectId}&flagged=true`);
    const flaggedRow = flagged.body.find((s: { id: string }) => s.id === studentId);
    expect(flaggedRow).toBeDefined();
    expect(flaggedRow.stageInfo).toMatchObject({ flagged: true, flagReason: "IDLE" });
    expect(flaggedRow.stageInfo.ageDays).toBe(5);

    // Stage filter includes it; a different stage excludes it.
    const byStage = await authRequest(app).get(
      `/api/v1/students?projectId=${projectId}&stage=LOGIN_ACTIVATED`
    );
    expect(byStage.body.some((s: { id: string }) => s.id === studentId)).toBe(true);

    const otherStage = await authRequest(app).get(
      `/api/v1/students?projectId=${projectId}&stage=ASSESSMENT_COMPLETED`
    );
    expect(otherStage.body.some((s: { id: string }) => s.id === studentId)).toBe(false);
  });

  it("rejects a divisionId that doesn't belong to the given project's institute", async () => {
    const res = await authRequest(app).post("/api/v1/students").send({
      firstName: "Ravi",
      lastName: "Kumar",
      email: "ravi@test-student.example",
      mobile: "+919876500003",
      studentCode: "CB2",
      projectId: otherProjectId,
      divisionId,
      parentMobile: "+919876500004",
      parentEmail: "parent-ravi@test-student.example",
      fatherName: "Kumar Sr",
      fatherOccupation: "Engineer",
      motherName: "Kumar Jr",
      motherOccupation: "Doctor",
    });

    expect(res.status).toBe(400);
  });

  it("rejects a duplicate parent mobile with 409", async () => {
    await authRequest(app).post("/api/v1/students").send({
      firstName: "Meera",
      lastName: "Iyer",
      email: "meera@test-student.example",
      mobile: "+919876500005",
      studentCode: "CB3",
      projectId,
      divisionId,
      parentMobile: "+919876500099",
      parentEmail: "parent-meera@test-student.example",
      fatherName: "Iyer Sr",
      fatherOccupation: "Engineer",
      motherName: "Iyer Jr",
      motherOccupation: "Doctor",
    });

    const res = await authRequest(app).post("/api/v1/students").send({
      firstName: "Nina",
      lastName: "Iyer",
      email: "nina@test-student.example",
      mobile: "+919876500006",
      studentCode: "CB4",
      projectId,
      divisionId,
      parentMobile: "+919876500099",
      parentEmail: "parent-nina@test-student.example",
      fatherName: "Iyer Sr",
      fatherOccupation: "Engineer",
      motherName: "Iyer Jr",
      motherOccupation: "Doctor",
    });

    expect(res.status).toBe(409);
  });
});
