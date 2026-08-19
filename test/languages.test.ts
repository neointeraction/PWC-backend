import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

describe("Languages API", () => {
  beforeAll(async () => {
    await prisma.language.upsert({
      where: { code: "en" },
      update: { isDefault: true, isActive: true },
      create: { code: "en", name: "English", isDefault: true, displayOrder: 1 },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists active languages including English as the default", async () => {
    const res = await authRequest(app).get("/api/v1/languages");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const english = res.body.find((l: { code: string }) => l.code === "en");
    expect(english).toBeDefined();
    expect(english.name).toBe("English");
    expect(english.isDefault).toBe(true);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/languages");
    expect(res.status).toBe(401);
  });

  it("allows staff (counsellor) to read the list", async () => {
    const res = await request(app)
      .get("/api/v1/languages")
      .set("Authorization", bearer("COUNSELLOR"));
    expect(res.status).toBe(200);
  });
});
