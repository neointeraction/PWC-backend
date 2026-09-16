import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest } from "./helpers/http.js";

const app = createApp();

describe("Project wizard API", () => {
  beforeAll(async () => {
    await prisma.language.upsert({
      where: { code: "en" },
      update: { isDefault: true, isActive: true },
      create: { code: "en", name: "English", isDefault: true, displayOrder: 1 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-wizard.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project Wizard" } } });
    await prisma.$disconnect();
  });

  it("creates a project, onboards students, and imports counsellor slots in one call", async () => {
    const res = await authRequest(app)
      .post("/api/v1/projects/wizard")
      .send({
        project: {
          code: "PWIZ1",
          name: "Test Project Wizard A",
          address: "1 Wizard St",
          contactNumber: "+919876590101",
          primaryEmail: "wiza@test-wizard.example",
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
        },
        students: [
          {
            firstName: "Wiz",
            lastName: "StudentA",
            email: "wiz-student-a@test-wizard.example",
            mobile: "+919876590102",
            studentCode: "SWIZA",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590103",
            parentEmail: "wiz-parent-a@test-wizard.example",
          },
        ],
        counsellorSlots: [
          {
            counsellorCode: "CWIZA",
            firstName: "Wiz",
            lastName: "CounsellorA",
            email: "wiz-counsellor-a@test-wizard.example",
            mobile: "+919876590104",
            date: "2026-02-01",
            startTime: "10:00",
            endTime: "10:30",
          },
          {
            counsellorCode: "CWIZA",
            date: "2026-02-01",
            startTime: "11:00",
            endTime: "11:30",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.project.code).toBe("PWIZ1");
    expect(res.body.studentsCreated).toBe(1);
    expect(res.body.counsellorsAssigned).toBe(1);
    expect(res.body.slotsImported).toBe(2);

    const project = await prisma.project.findUnique({ where: { code: "PWIZ1" } });
    expect(project).not.toBeNull();

    const student = await prisma.student.findUnique({ where: { studentCode: "SWIZA" } });
    expect(student?.className).toBe("Grade 9");
    expect(student?.divisionName).toBe("A");
    expect(student?.projectId).toBe(project!.id);

    const counsellor = await prisma.counsellor.findUnique({ where: { counsellorCode: "CWIZA" } });
    expect(counsellor).not.toBeNull();

    const assignment = await prisma.projectCounsellor.findUnique({
      where: { projectId_counsellorId: { projectId: project!.id, counsellorId: counsellor!.id } },
    });
    expect(assignment).not.toBeNull();

    const slots = await prisma.counsellorSlot.findMany({ where: { projectId: project!.id } });
    expect(slots).toHaveLength(2);
  });

  it("reuses an existing counsellor by counsellorCode instead of creating a duplicate", async () => {
    const existingCounsellorUser = await prisma.user.create({
      data: {
        email: "wiz-existing-counsellor@test-wizard.example",
        passwordHash: "x",
        role: "COUNSELLOR",
        firstName: "Existing",
        lastName: "Counsellor",
      },
    });
    const existingCounsellor = await prisma.counsellor.create({
      data: { userId: existingCounsellorUser.id, counsellorCode: "CWIZEXIST", mobile: "+919876590199" },
    });

    const res = await authRequest(app)
      .post("/api/v1/projects/wizard")
      .send({
        project: {
          code: "PWIZ2",
          name: "Test Project Wizard B",
          contactNumber: "+919876590201",
          primaryEmail: "wizb@test-wizard.example",
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
        },
        students: [
          {
            firstName: "Wiz",
            lastName: "StudentB",
            email: "wiz-student-b@test-wizard.example",
            mobile: "+919876590202",
            studentCode: "SWIZB",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590203",
            parentEmail: "wiz-parent-b@test-wizard.example",
          },
        ],
        counsellorSlots: [
          { counsellorCode: "CWIZEXIST", date: "2026-02-01", startTime: "09:00", endTime: "09:30" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.counsellorsAssigned).toBe(1);

    const counsellorCount = await prisma.counsellor.count({ where: { counsellorCode: "CWIZEXIST" } });
    expect(counsellorCount).toBe(1);

    const project = await prisma.project.findUnique({ where: { code: "PWIZ2" } });
    const assignment = await prisma.projectCounsellor.findUnique({
      where: { projectId_counsellorId: { projectId: project!.id, counsellorId: existingCounsellor.id } },
    });
    expect(assignment).not.toBeNull();

    await prisma.user.delete({ where: { id: existingCounsellorUser.id } });
  });

  it("skips an unknown counsellorCode with no identity row instead of failing the call", async () => {
    const res = await authRequest(app)
      .post("/api/v1/projects/wizard")
      .send({
        project: {
          code: "PWIZ3",
          name: "Test Project Wizard C",
          contactNumber: "+919876590301",
          primaryEmail: "wizc@test-wizard.example",
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
        },
        students: [
          {
            firstName: "Wiz",
            lastName: "StudentC",
            email: "wiz-student-c@test-wizard.example",
            mobile: "+919876590302",
            studentCode: "SWIZC",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590303",
            parentEmail: "wiz-parent-c@test-wizard.example",
          },
        ],
        counsellorSlots: [
          { counsellorCode: "CWIZUNKNOWN", date: "2026-02-01", startTime: "09:00", endTime: "09:30" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.studentsCreated).toBe(1);
    expect(res.body.counsellorsAssigned).toBe(0);
    expect(res.body.slotsImported).toBe(0);
    expect(res.body.slotsSkipped).toHaveLength(1);
    expect(res.body.slotsSkipped[0]).toMatchObject({ counsellorCode: "CWIZUNKNOWN" });

    const project = await prisma.project.findUnique({ where: { code: "PWIZ3" } });
    expect(project).not.toBeNull();

    const counsellor = await prisma.counsellor.findUnique({ where: { counsellorCode: "CWIZUNKNOWN" } });
    expect(counsellor).toBeNull();
  });

  it("skips a student row that conflicts on a duplicate field, but still creates the rest", async () => {
    await prisma.user.create({
      data: {
        email: "wiz-dup@test-wizard.example",
        passwordHash: "x",
        role: "STUDENT",
        firstName: "Dup",
        lastName: "Existing",
      },
    });

    const res = await authRequest(app)
      .post("/api/v1/projects/wizard")
      .send({
        project: {
          code: "PWIZ4",
          name: "Test Project Wizard D",
          contactNumber: "+919876590401",
          primaryEmail: "wizd@test-wizard.example",
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
        },
        students: [
          {
            firstName: "Dup",
            lastName: "StudentD",
            email: "wiz-dup@test-wizard.example",
            mobile: "+919876590402",
            studentCode: "SWIZD",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590403",
            parentEmail: "wiz-parent-d@test-wizard.example",
          },
          {
            firstName: "Clean",
            lastName: "StudentD2",
            email: "wiz-clean-d2@test-wizard.example",
            mobile: "+919876590405",
            studentCode: "SWIZD2",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590406",
            parentEmail: "wiz-parent-d2@test-wizard.example",
          },
        ],
        counsellorSlots: [],
      });

    expect(res.status).toBe(201);
    expect(res.body.studentsCreated).toBe(1);
    expect(res.body.studentsSkipped).toHaveLength(1);
    expect(res.body.studentsSkipped[0]).toMatchObject({ index: 0, reason: expect.stringContaining("email") });

    const project = await prisma.project.findUnique({ where: { code: "PWIZ4" } });
    expect(project).not.toBeNull();

    const skippedStudent = await prisma.student.findUnique({ where: { studentCode: "SWIZD" } });
    expect(skippedStudent).toBeNull();

    const createdStudent = await prisma.student.findUnique({ where: { studentCode: "SWIZD2" } });
    expect(createdStudent).not.toBeNull();
  });

  it("still fails the whole call when every student row conflicts", async () => {
    await prisma.user.create({
      data: {
        email: "wiz-dup-e@test-wizard.example",
        passwordHash: "x",
        role: "STUDENT",
        firstName: "Dup",
        lastName: "ExistingE",
      },
    });

    const res = await authRequest(app)
      .post("/api/v1/projects/wizard")
      .send({
        project: {
          code: "PWIZ5",
          name: "Test Project Wizard E",
          contactNumber: "+919876590501",
          primaryEmail: "wize@test-wizard.example",
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
        },
        students: [
          {
            firstName: "Dup",
            lastName: "StudentE",
            email: "wiz-dup-e@test-wizard.example",
            mobile: "+919876590502",
            studentCode: "SWIZE",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590503",
            parentEmail: "wiz-parent-e@test-wizard.example",
          },
        ],
        counsellorSlots: [],
      });

    expect(res.status).toBe(400);

    const project = await prisma.project.findUnique({ where: { code: "PWIZ5" } });
    expect(project).toBeNull();
  });

  it("skips a counsellor slot that collides with an existing booking, but keeps the rest", async () => {
    const existingCounsellorUser = await prisma.user.create({
      data: {
        email: "wiz-slot-counsellor@test-wizard.example",
        passwordHash: "x",
        role: "COUNSELLOR",
        firstName: "Slot",
        lastName: "Counsellor",
      },
    });
    const existingCounsellor = await prisma.counsellor.create({
      data: { userId: existingCounsellorUser.id, counsellorCode: "CWIZSLOT", mobile: "+919876590601" },
    });
    const priorProject = await prisma.project.create({
      data: {
        code: "PWIZPRIOR",
        name: "Test Project Wizard Prior",
        address: "1 Prior St",
        contactNumber: "+919876590602",
        primaryEmail: "wizprior@test-wizard.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
        languageId: (await prisma.language.findFirstOrThrow({ where: { code: "en" } })).id,
      },
    });
    await prisma.counsellorSlot.create({
      data: {
        counsellorId: existingCounsellor.id,
        projectId: priorProject.id,
        slotDate: new Date("2026-02-01T00:00:00.000Z"),
        startTime: "10:00",
        endTime: "10:30",
      },
    });

    const res = await authRequest(app)
      .post("/api/v1/projects/wizard")
      .send({
        project: {
          code: "PWIZ6",
          name: "Test Project Wizard F",
          contactNumber: "+919876590701",
          primaryEmail: "wizf@test-wizard.example",
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
        },
        students: [
          {
            firstName: "Wiz",
            lastName: "StudentF",
            email: "wiz-student-f@test-wizard.example",
            mobile: "+919876590702",
            studentCode: "SWIZF",
            className: "Grade 9",
            divisionName: "A",
            parentMobile: "+919876590703",
            parentEmail: "wiz-parent-f@test-wizard.example",
          },
        ],
        counsellorSlots: [
          // Collides with the slot already booked on priorProject — same counsellor, same date+time.
          { counsellorCode: "CWIZSLOT", date: "2026-02-01", startTime: "10:00", endTime: "10:30" },
          { counsellorCode: "CWIZSLOT", date: "2026-02-01", startTime: "11:00", endTime: "11:30" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.counsellorsAssigned).toBe(1);
    expect(res.body.slotsImported).toBe(1);
    expect(res.body.slotsSkipped).toHaveLength(1);
    expect(res.body.slotsSkipped[0]).toMatchObject({
      counsellorCode: "CWIZSLOT",
      date: "2026-02-01",
      startTime: "10:00",
      reason: expect.stringContaining("already booked"),
    });

    const project = await prisma.project.findUnique({ where: { code: "PWIZ6" } });
    const slots = await prisma.counsellorSlot.findMany({ where: { projectId: project!.id } });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.startTime).toBe("11:00");

    await prisma.counsellorSlot.deleteMany({ where: { projectId: priorProject.id } });
    await prisma.project.delete({ where: { id: priorProject.id } });
    await prisma.user.delete({ where: { id: existingCounsellorUser.id } });
  });
});
