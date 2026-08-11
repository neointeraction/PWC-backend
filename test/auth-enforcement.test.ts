import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bearer } from "./helpers/http.js";

const app = createApp();
const COHORT = "CLASS_9_10";

// Verifies the route-level auth guards themselves (the happy-path behaviour of every
// other suite is covered with an admin token via authRequest). No DB writes here.
describe("Auth enforcement", () => {
  it("401s a protected route with no token", async () => {
    const res = await request(app).get("/api/v1/institutes");
    expect(res.status).toBe(401);
  });

  it("401s a protected route with a malformed/invalid token", async () => {
    const res = await request(app).get("/api/v1/institutes").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("403s when the role is insufficient (STUDENT hitting a staff route)", async () => {
    const res = await request(app).get("/api/v1/institutes").set("Authorization", bearer("STUDENT"));
    expect(res.status).toBe(403);
  });

  it("403s when a COUNSELLOR hits an admin-only route (create institute)", async () => {
    const res = await request(app)
      .post("/api/v1/institutes")
      .set("Authorization", bearer("COUNSELLOR"))
      .send({ name: "X", address: "Y", contactNumber: "+919000000000", primaryEmail: "x@example.test" });
    expect(res.status).toBe(403); // 403, not a validation 400 — guard runs before the body is processed
  });

  it("allows a staff role through a staff route", async () => {
    const res = await request(app).get("/api/v1/institutes").set("Authorization", bearer("COUNSELLOR"));
    expect(res.status).toBe(200);
  });

  it("allows any authenticated user through career-library, but 401s without a token", async () => {
    const noToken = await request(app).get("/api/v1/career-library/filters");
    expect(noToken.status).toBe(401);

    const student = await request(app)
      .get("/api/v1/career-library/filters")
      .set("Authorization", bearer("STUDENT"));
    expect(student.status).toBe(200);
  });

  // Parents have no login — parent forms must be reachable with no token.
  it("keeps parent forms public (no token required)", async () => {
    const res = await request(app).get("/api/v1/forms/PRE_COUNSELLING_PARENT").query({ cohort: COHORT });
    expect(res.status).toBe(200);
    expect(res.body.formType).toBe("PRE_COUNSELLING_PARENT");
  });

  it("requires a login for student forms", async () => {
    const noToken = await request(app).get("/api/v1/forms/PRE_COUNSELLING_STUDENT").query({ cohort: COHORT });
    expect(noToken.status).toBe(401);

    const withStudent = await request(app)
      .get("/api/v1/forms/PRE_COUNSELLING_STUDENT")
      .query({ cohort: COHORT })
      .set("Authorization", bearer("STUDENT"));
    expect(withStudent.status).toBe(200);
  });
});
