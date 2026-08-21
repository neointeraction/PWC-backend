import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

let instituteId: string;
let divisionId: string;

describe("Projects API", () => {
  beforeAll(async () => {
    // Project creation resolves the default language (English); ensure it exists.
    await prisma.language.upsert({
      where: { code: "en" },
      update: { isDefault: true, isActive: true },
      create: { code: "en", name: "English", isDefault: true, displayOrder: 1 },
    });

    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute Projects",
      address: "1 Proj St",
      contactNumber: "+919876573001",
      primaryEmail: "projects@test-institute.example",
    });
    instituteId = institute.body.id;

    const klass = await authRequest(app).post(`/api/v1/institutes/${instituteId}/classes`).send({ name: "Grade 9" });
    const division = await authRequest(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "A" });
    divisionId = division.body.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-projects.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Test Project CRUD" } } });
    await prisma.institute.deleteMany({ where: { name: "Test Institute Projects" } });
    await prisma.$disconnect();
  });

  it("creates a project", async () => {
    const res = await authRequest(app).post("/api/v1/projects").send({
      instituteId,
      name: "Test Project CRUD A",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Project CRUD A");
    expect(res.body.code).toMatch(/^P\d{4,}$/);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.institute.id).toBe(instituteId);
    expect(res.body._count.students).toBe(0);
    // Defaults to English when no languageId is supplied.
    expect(res.body.language.code).toBe("en");
  });

  it("rejects a bad date order with 400", async () => {
    const res = await authRequest(app).post("/api/v1/projects").send({
      instituteId,
      name: "Test Project CRUD Bad",
      fromDate: "2026-12-31",
      toDate: "2026-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown instituteId with 400", async () => {
    const res = await authRequest(app).post("/api/v1/projects").send({
      instituteId: "clzzzzzzzzzzzzzzzzzzzzzzzz",
      name: "Test Project CRUD Orphan",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate name within the same institute with 409", async () => {
    await authRequest(app).post("/api/v1/projects").send({
      instituteId,
      name: "Test Project CRUD Dup",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    const res = await authRequest(app).post("/api/v1/projects").send({
      instituteId,
      name: "Test Project CRUD Dup",
      fromDate: "2026-02-01",
      toDate: "2026-11-30",
    });
    expect(res.status).toBe(409);
  });

  it("lists projects, filterable by status", async () => {
    const all = await authRequest(app).get("/api/v1/projects").query({ instituteId });
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(0);

    const active = await authRequest(app).get("/api/v1/projects").query({ status: "ACTIVE" });
    expect(active.status).toBe(200);
    expect(active.body.every((p: { status: string }) => p.status === "ACTIVE")).toBe(true);
  });

  it("gets, updates (incl. closing), and rejects a bad merged date range", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      instituteId,
      name: "Test Project CRUD Update",
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
      instituteId,
      name: "Test Project CRUD Delete",
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
    const defaultList = await authRequest(app).get("/api/v1/projects").query({ instituteId });
    expect(defaultList.body.some((p: { id: string }) => p.id === id)).toBe(false);
    const deletedList = await authRequest(app).get("/api/v1/projects").query({ instituteId, status: "DELETED" });
    expect(deletedList.body.some((p: { id: string }) => p.id === id)).toBe(true);
    expect(deletedList.body.every((p: { status: string }) => p.status === "DELETED")).toBe(true);

    // Restore → always ACTIVE, back in the default list.
    const restored = await authRequest(app).patch(`/api/v1/projects/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe("ACTIVE");
    const afterRestore = await authRequest(app).get("/api/v1/projects").query({ instituteId });
    expect(afterRestore.body.some((p: { id: string }) => p.id === id)).toBe(true);
  });

  it("soft-delete works even when the project has students (data preserved, no 409)", async () => {
    const created = await authRequest(app).post("/api/v1/projects").send({
      instituteId,
      name: "Test Project CRUD WithStudents",
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
      divisionId,
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

  it("enforces auth: 401 without token, 403 for a counsellor creating (admin-only)", async () => {
    const noToken = await request(app).get("/api/v1/projects");
    expect(noToken.status).toBe(401);

    const asCounsellor = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", bearer("COUNSELLOR"))
      .send({ instituteId, name: "Test Project CRUD NoPerm", fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(asCounsellor.status).toBe(403);
  });
});
