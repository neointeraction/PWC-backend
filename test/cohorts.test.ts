import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest } from "./helpers/http.js";

const app = createApp();

describe("Cohorts API", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists active cohorts for the dropdown (includes the seeded Class 9-10)", async () => {
    const res = await authRequest(app).get("/api/v1/cohorts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const class910 = res.body.find((c: { code: string }) => c.code === "CLASS_9_10");
    expect(class910).toBeTruthy();
    expect(class910.name).toBe("Class 9 & 10");
    expect(class910.id).toBeTypeOf("string");
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/api/v1/cohorts");
    expect(res.status).toBe(401);
  });
});
