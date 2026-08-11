import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("Forms API", () => {
  it("returns the pre-counselling student form with ordered questions for the seeded cohort", async () => {
    const res = await authRequest(app)
      .get("/api/v1/forms/PRE_COUNSELLING_STUDENT")
      .query({ cohort: "CLASS_9_10" });

    expect(res.status).toBe(200);
    expect(res.body.formType).toBe("PRE_COUNSELLING_STUDENT");
    expect(res.body.questions).toHaveLength(19);
    expect(res.body.questions[0].order).toBe(1);
    expect(res.body.questions.at(-1).order).toBe(19);
  });

  it("returns 404 for a cohort with no seeded form", async () => {
    const res = await authRequest(app)
      .get("/api/v1/forms/PRE_COUNSELLING_STUDENT")
      .query({ cohort: "CLASS_11_12" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid formType", async () => {
    const res = await authRequest(app)
      .get("/api/v1/forms/NOT_A_FORM_TYPE")
      .query({ cohort: "CLASS_9_10" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when cohort query param is missing", async () => {
    const res = await authRequest(app).get("/api/v1/forms/PRE_COUNSELLING_STUDENT");

    expect(res.status).toBe(400);
  });
});
