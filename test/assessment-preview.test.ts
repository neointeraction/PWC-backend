import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const COHORT = "CLASS_9_10";

interface Q { fieldKey: string; format: string; options: { value: string }[] | null }

describe("Assessment score-preview (dev/QA)", () => {
  it("scores ad-hoc answers with no student/attempt and returns the full report", async () => {
    const questions = (await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT })).body as Q[];
    const answers = questions.map((q) => ({
      fieldKey: q.fieldKey,
      response: q.format === "MCQ_SINGLE" ? q.options?.[0]?.value ?? "A" : "5",
    }));

    const res = await authRequest(app).post("/api/v1/assessment/score-preview").send({ cohort: COHORT, answers });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.traitScores)).toHaveLength(18);
    expect(res.body.riasec.scores).toHaveLength(6);
    expect(res.body.dominantCareerStyle.code).toHaveLength(3);
    expect(Array.isArray(res.body.streamFit.top3)).toBe(true);
    expect(res.body.careerFit).not.toBeNull();
    expect(res.body.reliability.rvs).toBeTruthy();
  });

  it("works with partial answers (unanswered score as neutral)", async () => {
    const res = await authRequest(app)
      .post("/api/v1/assessment/score-preview")
      .send({ cohort: COHORT, answers: [] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.traitScores)).toHaveLength(18);
  });

  it("404s an unknown cohort", async () => {
    const res = await authRequest(app).post("/api/v1/assessment/score-preview").send({ cohort: "NOPE", answers: [] });
    expect(res.status).toBe(404);
  });

  it("requires staff: 401 without token, 403 for a student", async () => {
    const noToken = await request(app).post("/api/v1/assessment/score-preview").send({ cohort: COHORT, answers: [] });
    expect(noToken.status).toBe(401);

    const student = await request(app)
      .post("/api/v1/assessment/score-preview")
      .set("Authorization", bearer("STUDENT"))
      .send({ cohort: COHORT, answers: [] });
    expect(student.status).toBe(403);
  });
});
