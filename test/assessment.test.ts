import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("Assessment API", () => {
  it("returns all 73 seeded questions for the cohort, ordered", async () => {
    const res = await request(app).get("/api/v1/assessment/questions").query({ cohort: "CLASS_9_10" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(73);
    expect(res.body[0].order).toBe(1);
    expect(res.body.at(-1).order).toBe(73);
  });

  it("filters by section", async () => {
    const res = await request(app)
      .get("/api/v1/assessment/questions")
      .query({ cohort: "CLASS_9_10", section: "APTITUDE" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(20);
    expect(res.body.every((q: { section: string }) => q.section === "APTITUDE")).toBe(true);
  });

  it("never exposes correctOption in the response", async () => {
    const res = await request(app)
      .get("/api/v1/assessment/questions")
      .query({ cohort: "CLASS_9_10", section: "APTITUDE" });

    expect(res.status).toBe(200);
    for (const question of res.body) {
      expect(question).not.toHaveProperty("correctOption");
    }
  });

  it("returns 400 when cohort query param is missing", async () => {
    const res = await request(app).get("/api/v1/assessment/questions");

    expect(res.status).toBe(400);
  });
});
