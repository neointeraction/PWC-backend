import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

describe("SCRI Band Guidance API", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists all 4 SCRI bands with their score range and guidance text", async () => {
    const res = await authRequest(app).get("/api/v1/scri-band-guidance");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.data.map((b: { band: number }) => b.band)).toEqual([1, 2, 3, 4]);

    const band2 = res.body.data.find((b: { band: number }) => b.band === 2);
    expect(band2.score).toEqual({ min: 11, max: 15 });
    expect(band2.label).toBe("Early Exploration");
    expect(typeof band2.labelMeaning).toBe("string");
    expect(typeof band2.tipsForStudents).toBe("string");
    expect(typeof band2.tipsForParent).toBe("string");
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/scri-band-guidance");
    expect(res.status).toBe(401);
  });

  it("allows a student to read it (not staff-only)", async () => {
    const res = await request(app)
      .get("/api/v1/scri-band-guidance")
      .set("Authorization", bearer("STUDENT"));
    expect(res.status).toBe(200);
  });
});
