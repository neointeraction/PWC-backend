import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

describe("Institutes API", () => {
  afterAll(async () => {
    await prisma.institute.deleteMany({ where: { name: { startsWith: "Test Institute Basic" } } });
    await prisma.$disconnect();
  });

  it("creates an institute", async () => {
    const res = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Basic A",
      address: "123 Main St",
      contactNumber: "+919876543210",
      primaryEmail: "contact-a@test-institute.example",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Test Institute Basic A" });
  });

  it("rejects a duplicate primary email with 409", async () => {
    await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Basic B",
      address: "456 Side St",
      contactNumber: "+919876543211",
      primaryEmail: "dup@test-institute.example",
    });

    const res = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Basic C",
      address: "789 Other St",
      contactNumber: "+919876543212",
      primaryEmail: "dup@test-institute.example",
    });

    expect(res.status).toBe(409);
  });

  it("rejects an invalid phone number with 400", async () => {
    const res = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Basic D",
      address: "1 Bad Phone Rd",
      contactNumber: "not-a-phone",
      primaryEmail: "badphone@test-institute.example",
    });

    expect(res.status).toBe(400);
  });

  it("creates a class and division under an institute", async () => {
    const instituteRes = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Basic E",
      address: "1 Class St",
      contactNumber: "+919876543213",
      primaryEmail: "classes@test-institute.example",
    });
    const instituteId = instituteRes.body.id;

    const classRes = await request(app)
      .post(`/api/v1/institutes/${instituteId}/classes`)
      .send({ name: "Grade 10" });
    expect(classRes.status).toBe(201);

    const divisionRes = await request(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${classRes.body.id}/divisions`)
      .send({ name: "A" });
    expect(divisionRes.status).toBe(201);
    expect(divisionRes.body).toMatchObject({ name: "A" });
  });
});
