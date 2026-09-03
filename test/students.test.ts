import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

let projectId: string;

describe("Students API", () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        code: "P-STU",
        name: "Test Project Students",
        address: "1 Student St",
        contactNumber: "+919876540001",
        primaryEmail: "students@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-student.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project Students" } } });
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
      className: "Grade 9",
      divisionName: "A",
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
    expect(res.body.student.className).toBe("Grade 9");
    expect(res.body.student.divisionName).toBe("A");
  });

  it("rejects a missing studentCode with 400 (no auto-generation)", async () => {
    const res = await authRequest(app).post("/api/v1/students").send({
      firstName: "NoCode",
      lastName: "Student",
      email: "nocode@test-student.example",
      mobile: "+919876500051",
      projectId,
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876500052",
      parentEmail: "parent-nocode@test-student.example",
      fatherName: "Code Sr",
    });

    expect(res.status).toBe(400);
  });

  it("lets a student fetch their own record via /students/me and confirm their profile", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Self",
      lastName: "Service",
      email: "self@test-student.example",
      mobile: "+919876500061",
      studentCode: "CB-SELF",
      projectId,
      className: "Grade 9",
      divisionName: "A",
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
    expect(me.body.studentCode).toBe("CB-SELF");
    expect(me.body.workflowStatus).toBe("DRAFT");
    // Cohort surfaced for the frontend to request the right form/assessment bank.
    expect(me.body).toHaveProperty("cohort");

    // Student confirms their own profile → workflow advances.
    const confirm = await asStudent.post(`/api/v1/students/${studentId}/confirm-profile`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.workflowStatus).toBe("PROFILE_COMPLETED");
  });

  it("lets a student edit their own parent/contact details via PATCH /students/me, ignoring locked fields", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Edit",
      lastName: "Me",
      email: "editme@test-student.example",
      mobile: "+919876500091",
      studentCode: "CB-EDIT",
      projectId,
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876500092",
      parentEmail: "parent-editme@test-student.example",
      fatherName: "Old Father",
    });
    expect(created.status).toBe(201);
    const studentId: string = created.body.student.id;
    const userId: string = created.body.student.user.id;

    const asStudent = authRequest(app, "STUDENT", { userId });

    const res = await asStudent.patch("/api/v1/students/me").send({
      fatherName: "New Father",
      motherName: "New Mother",
      parentEmail: "updated-parent@test-student.example",
      // Locked identity/enrolment fields are stripped by validation, not applied.
      firstName: "Hacked",
      email: "hacked@test-student.example",
      studentCode: "HACK1",
      workflowStatus: "CLOSED",
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(studentId);
    expect(res.body.user.firstName).toBe("Edit"); // unchanged
    expect(res.body.user.email).toBe("editme@test-student.example"); // unchanged
    expect(res.body.workflowStatus).toBe("DRAFT"); // unchanged

    const persisted = await prisma.student.findUnique({ where: { id: studentId } });
    expect(persisted?.fatherName).toBe("New Father");
    expect(persisted?.motherName).toBe("New Mother");
    expect(persisted?.parentEmail).toBe("updated-parent@test-student.example");
  });

  it("404s PATCH /students/me for a non-student account", async () => {
    const res = await authRequest(app, "COUNSELLOR", { userId: "staff-no-student-patch" })
      .patch("/api/v1/students/me")
      .send({ fatherName: "X" });
    expect(res.status).toBe(404);
  });

  it("stops a student from confirming another student's profile", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Victim",
      lastName: "Student",
      email: "victim@test-student.example",
      mobile: "+919876500071",
      studentCode: "CB-VICTIM",
      projectId,
      className: "Grade 9",
      divisionName: "A",
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
      studentCode: "CB-IDLE",
      projectId,
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876500082",
      parentEmail: "parent-idle@test-student.example",
      fatherName: "Idle Sr",
    });
    const studentId: string = created.body.student.id;

    // Freshly created (DRAFT, no login yet, today) → Invited, not yet flagged.
    const fresh = await authRequest(app).get(`/api/v1/students?projectId=${projectId}`);
    const freshRow = fresh.body.find((s: { id: string }) => s.id === studentId);
    expect(freshRow.stageInfo).toMatchObject({ stage: "INVITED", flagged: false });
    expect(freshRow.stageInfo.ageDays).toBe(0);
    expect(freshRow.user.passwordChangedAt).toBeNull();

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
      `/api/v1/students?projectId=${projectId}&stage=INVITED`
    );
    expect(byStage.body.some((s: { id: string }) => s.id === studentId)).toBe(true);

    const otherStage = await authRequest(app).get(
      `/api/v1/students?projectId=${projectId}&stage=ASSESSMENT_COMPLETED`
    );
    expect(otherStage.body.some((s: { id: string }) => s.id === studentId)).toBe(false);
  });

  it("filters students by className and divisionName", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Classy",
      lastName: "Student",
      email: "classy@test-student.example",
      mobile: "+919876500003",
      studentCode: "CB2",
      projectId,
      className: "Grade 10",
      divisionName: "B",
      parentMobile: "+919876500004",
      parentEmail: "parent-classy@test-student.example",
      fatherName: "Kumar Sr",
      fatherOccupation: "Engineer",
      motherName: "Kumar Jr",
      motherOccupation: "Doctor",
    });
    expect(created.status).toBe(201);
    const studentId: string = created.body.student.id;

    const byClass = await authRequest(app)
      .get("/api/v1/students")
      .query({ projectId, className: "Grade 10", divisionName: "B" });
    expect(byClass.status).toBe(200);
    expect(byClass.body.some((s: { id: string }) => s.id === studentId)).toBe(true);

    const otherClass = await authRequest(app)
      .get("/api/v1/students")
      .query({ projectId, className: "Grade 9" });
    expect(otherClass.body.some((s: { id: string }) => s.id === studentId)).toBe(false);
  });

  it("rejects a duplicate parent mobile with 409", async () => {
    await authRequest(app).post("/api/v1/students").send({
      firstName: "Meera",
      lastName: "Iyer",
      email: "meera@test-student.example",
      mobile: "+919876500005",
      studentCode: "CB3",
      projectId,
      className: "Grade 9",
      divisionName: "A",
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
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876500099",
      parentEmail: "parent-nina@test-student.example",
      fatherName: "Iyer Sr",
      fatherOccupation: "Engineer",
      motherName: "Iyer Jr",
      motherOccupation: "Doctor",
    });

    expect(res.status).toBe(409);
  });

  it("discontinues a student (marking inactive without deleting) and can reinstate them", async () => {
    const created = await authRequest(app).post("/api/v1/students").send({
      firstName: "Drop",
      lastName: "Out",
      email: "dropout@test-student.example",
      mobile: "+919876500101",
      studentCode: "CB-DROP",
      projectId,
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876500102",
      parentEmail: "parent-dropout@test-student.example",
      fatherName: "Dropout Sr",
    });
    const studentId: string = created.body.student.id;

    // Backdate creation so it would otherwise show up flagged/idle.
    await prisma.student.update({
      where: { id: studentId },
      data: { createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });

    const discontinued = await authRequest(app)
      .post(`/api/v1/students/${studentId}/discontinue`)
      .send({ reason: "Transferred schools" });
    expect(discontinued.status).toBe(200);
    expect(discontinued.body.isDiscontinued).toBe(true);
    expect(discontinued.body.discontinuedReason).toBe("Transferred schools");
    expect(discontinued.body.stageInfo).toMatchObject({ stage: "DISCONTINUED", flagged: false });

    // The student row (and linked user) still exist — this isn't a delete.
    const stillThere = await authRequest(app).get(`/api/v1/students/${studentId}`);
    expect(stillThere.status).toBe(200);

    // Excluded from the 🚩 follow-up flag even though it would otherwise be idle.
    const flaggedList = await authRequest(app).get(`/api/v1/students?projectId=${projectId}&flagged=true`);
    expect(flaggedList.body.some((s: { id: string }) => s.id === studentId)).toBe(false);

    // discontinued=false filters it out of the active list; discontinued=true finds it.
    const activeList = await authRequest(app).get(
      `/api/v1/students?projectId=${projectId}&discontinued=false`
    );
    expect(activeList.body.some((s: { id: string }) => s.id === studentId)).toBe(false);
    const discontinuedList = await authRequest(app).get(
      `/api/v1/students?projectId=${projectId}&discontinued=true`
    );
    expect(discontinuedList.body.some((s: { id: string }) => s.id === studentId)).toBe(true);

    // A repeat discontinue is a 409, not a silent overwrite.
    const repeat = await authRequest(app).post(`/api/v1/students/${studentId}/discontinue`);
    expect(repeat.status).toBe(409);

    const reinstated = await authRequest(app).post(`/api/v1/students/${studentId}/reinstate`);
    expect(reinstated.status).toBe(200);
    expect(reinstated.body.isDiscontinued).toBe(false);
    expect(reinstated.body.discontinuedReason).toBeNull();
    // workflowStatus was untouched throughout, so the derived stage resumes.
    expect(reinstated.body.stageInfo.stage).toBe("INVITED");

    const reinstateAgain = await authRequest(app).post(`/api/v1/students/${studentId}/reinstate`);
    expect(reinstateAgain.status).toBe(409);
  });
});
