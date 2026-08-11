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
