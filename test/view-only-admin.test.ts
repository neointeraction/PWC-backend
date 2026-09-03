import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bearer } from "./helpers/http.js";

const app = createApp();
const viewOnly = bearer("VIEW_ONLY_ADMIN");

describe("VIEW_ONLY_ADMIN — read everything, write nothing", () => {
  it("can READ the staff/admin views", async () => {
    for (const path of ["/api/v1/projects", "/api/v1/counsellors", "/api/v1/cohorts", "/api/v1/career-library/filters"]) {
      const res = await request(app).get(path).set("Authorization", viewOnly);
      expect(res.status, `GET ${path}`).toBe(200);
    }
  });

  it("is BLOCKED (403) on every write, before the route runs", async () => {
    const post = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", viewOnly)
      .send({
        code: "VO1",
        name: "X",
        address: "Y",
        contactNumber: "+919000000001",
        primaryEmail: "vo@example.test",
        fromDate: "2026-01-01",
        toDate: "2026-12-31",
      });
    expect(post.status).toBe(403);
    expect(post.body.error.message).toMatch(/view-only/i);

    const patch = await request(app)
      .patch("/api/v1/projects/clzzzzzzzzzzzzzzzzzzzzzzzz")
      .set("Authorization", viewOnly)
      .send({ name: "nope" });
    expect(patch.status).toBe(403);

    const del = await request(app)
      .delete("/api/v1/projects/clzzzzzzzzzzzzzzzzzzzzzzzz")
      .set("Authorization", viewOnly);
    expect(del.status).toBe(403);

    // Even a staff-tier action (not just admin-tier) is blocked.
    const email = await request(app)
      .post("/api/v1/email/send")
      .set("Authorization", viewOnly)
      .send({});
    expect(email.status).toBe(403);
  });

  it("can still change its OWN password (auth self-service is exempt from the write-block)", async () => {
    // The write-block is mounted after /auth, so this POST is NOT the view-only 403 — it
    // reaches the auth controller (401 here since the signed token has no matching user).
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", viewOnly)
      .send({ currentPassword: "x", newPassword: "new-password-123" });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(401);
  });

  it("still requires a valid token (no token → 401, not a silent pass)", async () => {
    const res = await request(app).get("/api/v1/projects");
    expect(res.status).toBe(401);
  });
});
