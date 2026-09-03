import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

describe("Projects API", () => {
  beforeAll(async () => {
    // Project creation resolves the default language (English); ensure it exists.
    await prisma.language.upsert({
      where: { code: "en" },
      update: { isDefault: true, isActive: true },
      create: { code: "en", name: "English", isDefault: true, displayOrder: 1 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-projects.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project CRUD" } } });
    await prisma.$disconnect();
  });

  it("creates a project", async () => {
    const res = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDA",
      name: "Test Project CRUD A",
      address: "1 Proj St",
      contactNumber: "+919876573101",
      primaryEmail: "proja@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Project CRUD A");
    expect(res.body.code).toBe("PCRUDA");
    expect(res.body.address).toBe("1 Proj St");
    expect(res.body.contactNumber).toBe("+919876573101");
    expect(res.body.primaryEmail).toBe("proja@test-projects.example");
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body._count.students).toBe(0);
    // Defaults to English when no languageId is supplied.
    expect(res.body.language.code).toBe("en");
  });

  it("rejects a bad date order with 400", async () => {
    const res = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDBAD",
      name: "Test Project CRUD Bad",
      contactNumber: "+919876573102",
      primaryEmail: "projbad@test-projects.example",
      fromDate: "2026-12-31",
      toDate: "2026-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid phone number with 400", async () => {
    const res = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDPHONE",
      name: "Test Project CRUD BadPhone",
      contactNumber: "not-a-phone",
      primaryEmail: "projphone@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate name with 409", async () => {
    await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDDUP1",
      name: "Test Project CRUD Dup",
      contactNumber: "+919876573103",
      primaryEmail: "projdup1@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const res = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDDUP2",
      name: "Test Project CRUD Dup",
      contactNumber: "+919876573104",
      primaryEmail: "projdup2@test-projects.example",
      fromDate: "2026-02-01",
      toDate: "2026-11-30",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a duplicate contactNumber or primaryEmail with 409", async () => {
    await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDUNIQ1",
      name: "Test Project CRUD Uniq1",
      contactNumber: "+919876573105",
      primaryEmail: "projuniq1@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const dupPhone = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDUNIQ2",
      name: "Test Project CRUD Uniq2",
      contactNumber: "+919876573105",
      primaryEmail: "projuniq2@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(dupPhone.status).toBe(409);

    const dupEmail = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDUNIQ3",
      name: "Test Project CRUD Uniq3",
      contactNumber: "+919876573106",
      primaryEmail: "projuniq1@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(dupEmail.status).toBe(409);
  });

  it("lists projects, filterable by status", async () => {
    const all = await authRequest(app).get("/api/v1/projects");
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(0);

    const active = await authRequest(app).get("/api/v1/projects").query({ status: "ACTIVE" });
    expect(active.status).toBe(200);
    expect(active.body.every((p: { status: string }) => p.status === "ACTIVE")).toBe(true);
  });

  it("gets, updates (incl. closing), and rejects a bad merged date range", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDUPD",
      name: "Test Project CRUD Update",
      contactNumber: "+919876573107",
      primaryEmail: "projupd@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const id = created.body.id;

    const got = await authRequest(app).get(`/api/v1/projects/${id}`);
    expect(got.status).toBe(200);

    const closed = await authRequest(app).patch(`/api/v1/projects/${id}`).send({ name: "Test Project CRUD Update R", status: "CLOSED" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("CLOSED");
    expect(closed.body.name).toBe("Test Project CRUD Update R");

    // Only toDate supplied, but it falls before the existing fromDate → 400.
    const badMerge = await authRequest(app).patch(`/api/v1/projects/${id}`).send({ toDate: "2025-01-01" });
    expect(badMerge.status).toBe(400);

    const missing = await authRequest(app).get("/api/v1/projects/clzzzzzzzzzzzzzzzzzzzzzzzz");
    expect(missing.status).toBe(404);
  });

  it("soft-deletes a project, hides it from the default list, and restores it", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDDEL",
      name: "Test Project CRUD Delete",
      contactNumber: "+919876573108",
      primaryEmail: "projdel@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const id = created.body.id;

    // DELETE = soft-delete → 200, status DELETED, row still present.
    const del = await authRequest(app).delete(`/api/v1/projects/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.status).toBe("DELETED");
    const got = await authRequest(app).get(`/api/v1/projects/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe("DELETED");

    // Default list excludes it; status=DELETED lists only soft-deleted.
    const defaultList = await authRequest(app).get("/api/v1/projects");
    expect(defaultList.body.some((p: { id: string }) => p.id === id)).toBe(false);
    const deletedList = await authRequest(app).get("/api/v1/projects").query({ status: "DELETED" });
    expect(deletedList.body.some((p: { id: string }) => p.id === id)).toBe(true);
    expect(deletedList.body.every((p: { status: string }) => p.status === "DELETED")).toBe(true);

    // Restore → always ACTIVE, back in the default list.
    const restored = await authRequest(app).patch(`/api/v1/projects/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe("ACTIVE");
    const afterRestore = await authRequest(app).get("/api/v1/projects");
    expect(afterRestore.body.some((p: { id: string }) => p.id === id)).toBe(true);
  });

  it("soft-delete works even when the project has students (data preserved, no 409)", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      code: "PCRUDWS",
      name: "Test Project CRUD WithStudents",
      contactNumber: "+919876573109",
      primaryEmail: "projws@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const id = created.body.id;

    const student = await authRequest(app).post("/api/v1/students").send({
      firstName: "Proj",
      lastName: "Student",
      email: "proj@test-projects.example",
      mobile: "+919876573010",
      studentCode: "PRJ1",
      projectId: id,
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876573011",
      parentEmail: "parent-proj@test-projects.example",
      fatherName: "F",
      fatherOccupation: "Engineer",
      motherName: "M",
      motherOccupation: "Doctor",
    });

    const del = await authRequest(app).delete(`/api/v1/projects/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.status).toBe("DELETED");
    // The student (and all its data) is preserved.
    const stillThere = await prisma.student.findUnique({ where: { id: student.body.student.id } });
    expect(stillThere).not.toBeNull();
  });

  it("rejects purging an ACTIVE project with 400, and 404s for an unknown id", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      code: "PPURGEACT",
      name: "Test Project CRUD PurgeActive",
      contactNumber: "+919876573110",
      primaryEmail: "projpurgeact@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const id = created.body.id;

    const rejected = await authRequest(app).delete(`/api/v1/projects/${id}/purge`);
    expect(rejected.status).toBe(400);
    // Row untouched.
    const stillThere = await prisma.project.findUnique({ where: { id } });
    expect(stillThere).not.toBeNull();

    const missing = await authRequest(app).delete("/api/v1/projects/clzzzzzzzzzzzzzzzzzzzzzzzz/purge");
    expect(missing.status).toBe(404);
  });

  it("purges a CLOSED project: hard-deletes the row, its students and their User accounts, and the ProjectCounsellor link — but leaves the Counsellor and its User account intact", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      code: "PPURGE",
      name: "Test Project CRUD Purge",
      contactNumber: "+919876573111",
      primaryEmail: "projpurge@test-projects.example",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const id = created.body.id;

    const counsellor = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Purge",
      lastName: "Counsellor",
      email: "purge-counsellor@test-projects.example",
      mobile: "+919876573020",
      counsellorCode: "PRGC1",
    });
    const counsellorId = counsellor.body.counsellor.id;
    const counsellorUserId = counsellor.body.counsellor.user?.id;
    await authRequest(app).post(`/api/v1/counsellors/${counsellorId}/projects`).send({ projectId: id });

    const student = await authRequest(app).post("/api/v1/students").send({
      firstName: "Purge",
      lastName: "Student",
      email: "purge-student@test-projects.example",
      mobile: "+919876573021",
      studentCode: "PRGS1",
      projectId: id,
      className: "Grade 9",
      divisionName: "A",
      parentMobile: "+919876573022",
      parentEmail: "purge-parent@test-projects.example",
      fatherName: "F",
      fatherOccupation: "Engineer",
      motherName: "M",
      motherOccupation: "Doctor",
    });
    const studentId = student.body.student.id;
    const studentUserId = student.body.student.user?.id;

    const closed = await authRequest(app).patch(`/api/v1/projects/${id}`).send({ status: "CLOSED" });
    expect(closed.status).toBe(200);

    const purged = await authRequest(app).delete(`/api/v1/projects/${id}/purge`);
    expect(purged.status).toBe(204);

    expect(await prisma.project.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.student.findUnique({ where: { id: studentId } })).toBeNull();
    if (studentUserId) {
      expect(await prisma.user.findUnique({ where: { id: studentUserId } })).toBeNull();
    }
    expect(
      await prisma.projectCounsellor.findFirst({ where: { projectId: id, counsellorId } })
    ).toBeNull();

    // Counsellor and its own User account survive the purge.
    expect(await prisma.counsellor.findUnique({ where: { id: counsellorId } })).not.toBeNull();
    if (counsellorUserId) {
      expect(await prisma.user.findUnique({ where: { id: counsellorUserId } })).not.toBeNull();
    }

    // Not found afterwards, either way (already deleted).
    const afterPurge = await authRequest(app).get(`/api/v1/projects/${id}`);
    expect(afterPurge.status).toBe(404);
    const purgeAgain = await authRequest(app).delete(`/api/v1/projects/${id}/purge`);
    expect(purgeAgain.status).toBe(404);
  });

  it("enforces auth: 401 without token, 403 for a counsellor creating (admin-only)", async () => {
    const noToken = await request(app).get("/api/v1/projects");
    expect(noToken.status).toBe(401);

    const asCounsellor = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", bearer("COUNSELLOR"))
      .send({
        code: "PCRUDNOPERM",
        name: "Test Project CRUD NoPerm",
        contactNumber: "+919876573112",
        primaryEmail: "projnoperm@test-projects.example",
        fromDate: "2026-01-01",
        toDate: "2026-12-31",
      });
    expect(asCounsellor.status).toBe(403);
  });
});
