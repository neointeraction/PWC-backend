import argon2 from "argon2";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { bearer } from "./helpers/http.js";

const app = createApp();
const superAdmin = bearer("SUPER_ADMIN");

describe("App Admins API (SUPER_ADMIN only)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-admins.example" } } });
    await prisma.$disconnect();
  });

  it("creates a full admin and a view-only admin", async () => {
    const full = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Ava", lastName: "Admin", email: "ava@test-admins.example",
    });
    expect(full.status).toBe(201);
    expect(full.body.tempPassword).toBeTypeOf("string");
    expect(full.body.admin.role).toBe("ADMIN"); // default

    const viewOnly = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Vic", lastName: "Viewer", email: "vic@test-admins.example", role: "VIEW_ONLY_ADMIN",
    });
    expect(viewOnly.status).toBe(201);
    expect(viewOnly.body.admin.role).toBe("VIEW_ONLY_ADMIN");
  });

  it("rejects a duplicate email with 409, and a disallowed role with 400", async () => {
    const dup = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Dup", lastName: "Email", email: "ava@test-admins.example",
    });
    expect(dup.status).toBe(409);

    const badRole = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "No", lastName: "Escalate", email: "esc@test-admins.example", role: "SUPER_ADMIN",
    });
    expect(badRole.status).toBe(400); // can't create/escalate to SUPER_ADMIN
  });

  it("lists admins (filterable by role) and toggles view-only via PATCH role", async () => {
    const created = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Tog", lastName: "Gle", email: "toggle@test-admins.example",
    });
    const id = created.body.admin.id;

    const list = await request(app).get("/api/v1/admins").set("Authorization", superAdmin);
    expect(list.status).toBe(200);
    expect(list.body.every((a: { role: string }) => ["ADMIN", "VIEW_ONLY_ADMIN"].includes(a.role))).toBe(true);

    const viewOnlyList = await request(app).get("/api/v1/admins").query({ role: "VIEW_ONLY_ADMIN" }).set("Authorization", superAdmin);
    expect(viewOnlyList.body.every((a: { role: string }) => a.role === "VIEW_ONLY_ADMIN")).toBe(true);

    // The view-only toggle: flip an ADMIN to VIEW_ONLY_ADMIN + deactivate.
    const patched = await request(app).patch(`/api/v1/admins/${id}`).set("Authorization", superAdmin).send({ role: "VIEW_ONLY_ADMIN", isActive: false });
    expect(patched.status).toBe(200);
    expect(patched.body.role).toBe("VIEW_ONLY_ADMIN");
    expect(patched.body.isActive).toBe(false);
  });

  it("is scoped to App Admins — can't read/delete a non-admin user", async () => {
    const student = await prisma.user.create({
      data: { email: "stud@test-admins.example", passwordHash: await argon2.hash("x"), role: "STUDENT", firstName: "S", lastName: "T" },
    });
    const get = await request(app).get(`/api/v1/admins/${student.id}`).set("Authorization", superAdmin);
    expect(get.status).toBe(404);
    const del = await request(app).delete(`/api/v1/admins/${student.id}`).set("Authorization", superAdmin);
    expect(del.status).toBe(404);
  });

  it("regenerates a temp password (returned once) and flags mustChangePassword; 404 for a non-admin id", async () => {
    const created = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Reg", lastName: "Enerate", email: "regen@test-admins.example",
    });
    const id = created.body.admin.id;
    const originalTemp = created.body.tempPassword;

    const regen = await request(app).post(`/api/v1/admins/${id}/regenerate-password`).set("Authorization", superAdmin);
    expect(regen.status).toBe(200);
    expect(regen.body.tempPassword).toBeTypeOf("string");
    expect(regen.body.tempPassword).not.toBe(originalTemp); // a fresh credential
    expect(regen.body.admin.mustChangePassword).toBe(true);

    // Scoped to App Admins — regenerating for a non-admin id 404s.
    const student = await prisma.user.create({
      data: { email: "regen-stud@test-admins.example", passwordHash: await argon2.hash("x"), role: "STUDENT", firstName: "S", lastName: "T" },
    });
    const notFound = await request(app).post(`/api/v1/admins/${student.id}/regenerate-password`).set("Authorization", superAdmin);
    expect(notFound.status).toBe(404);
  });

  it("enforces SUPER_ADMIN only on regenerate-password: 403 for a plain ADMIN, 401 without a token", async () => {
    const created = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Guard", lastName: "Regen", email: "guard-regen@test-admins.example",
    });
    const id = created.body.admin.id;

    const asAdmin = await request(app).post(`/api/v1/admins/${id}/regenerate-password`).set("Authorization", bearer("ADMIN"));
    expect(asAdmin.status).toBe(403);

    const noToken = await request(app).post(`/api/v1/admins/${id}/regenerate-password`);
    expect(noToken.status).toBe(401);
  });

  it("deletes an admin", async () => {
    const created = await request(app).post("/api/v1/admins").set("Authorization", superAdmin).send({
      firstName: "Del", lastName: "Ete", email: "delete@test-admins.example",
    });
    const id = created.body.admin.id;
    const del = await request(app).delete(`/api/v1/admins/${id}`).set("Authorization", superAdmin);
    expect(del.status).toBe(204);
    const got = await request(app).get(`/api/v1/admins/${id}`).set("Authorization", superAdmin);
    expect(got.status).toBe(404);
  });

  it("enforces SUPER_ADMIN only: 403 for a plain ADMIN, 401 without a token", async () => {
    const asAdmin = await request(app).post("/api/v1/admins").set("Authorization", bearer("ADMIN")).send({
      firstName: "X", lastName: "Y", email: "x@test-admins.example",
    });
    expect(asAdmin.status).toBe(403);

    const noToken = await request(app).get("/api/v1/admins");
    expect(noToken.status).toBe(401);
  });
});
