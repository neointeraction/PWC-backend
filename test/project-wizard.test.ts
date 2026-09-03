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
        students: [],
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

  it("rejects a new counsellorCode with no identity row, and creates nothing", async () => {
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
        students: [],
        counsellorSlots: [
          { counsellorCode: "CWIZUNKNOWN", date: "2026-02-01", startTime: "09:00", endTime: "09:30" },
        ],
      });

    expect(res.status).toBe(400);

    const project = await prisma.project.findUnique({ where: { code: "PWIZ3" } });
    expect(project).toBeNull();
  });

  it("rolls back the whole project when a student row conflicts on a duplicate field", async () => {
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
        ],
        counsellorSlots: [],
      });

    expect(res.status).toBe(409);

    const project = await prisma.project.findUnique({ where: { code: "PWIZ4" } });
    expect(project).toBeNull();
  });
});
