import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("Assessment API", () => {
  it("returns all 73 seeded questions in the interleaved presentation order", async () => {
    const res = await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: "CLASS_9_10" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(73);
    // Delivered sorted by displayOrder 1..73 (not by the logical/grouped `order`).
    expect(res.body[0].displayOrder).toBe(1);
    expect(res.body.at(-1).displayOrder).toBe(73);
    expect(res.body[0].order).toBe(13); // Q13 (Social) is shown first
  });

  it("filters by section", async () => {
    const res = await authRequest(app)
      .get("/api/v1/assessment/questions")
      .query({ cohort: "CLASS_9_10", section: "APTITUDE" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(20);
    expect(res.body.every((q: { section: string }) => q.section === "APTITUDE")).toBe(true);
  });

  it("never exposes correctOption in the response", async () => {
    const res = await authRequest(app)
      .get("/api/v1/assessment/questions")
      .query({ cohort: "CLASS_9_10", section: "APTITUDE" });

    expect(res.status).toBe(200);
    for (const question of res.body) {
      expect(question).not.toHaveProperty("correctOption");
    }
  });

  it("returns 400 when cohort query param is missing", async () => {
    const res = await authRequest(app).get("/api/v1/assessment/questions");

    expect(res.status).toBe(400);
  });
});
