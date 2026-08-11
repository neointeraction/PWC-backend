import argon2 from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

const EMAIL = "auth-test-user@test.example";
const PASSWORD = "correct-horse-battery-staple";

describe("Auth API", () => {
  beforeAll(async () => {
    const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (existing) await prisma.user.delete({ where: { id: existing.id } });

    await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
        role: "SUPER_ADMIN",
        firstName: "Auth",
        lastName: "Tester",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
  });

  it("rejects login with a wrong password", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects login for an unknown email", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "nobody@test.example", password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("logs in and sets a refresh token cookie", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.user.role).toBe("SUPER_ADMIN");
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^refreshToken=/);
  });

  it("rejects refresh with no cookie", async () => {
    const res = await request(app).post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("refreshes the access token and rotates the refresh token", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASSWORD });
    const cookie = login.headers["set-cookie"][0];

    const refreshed = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTypeOf("string");
    // Refresh token rotates to a new value even when the access token JWT happens to be
    // byte-identical (same payload + same-second iat as the login response).
    expect(refreshed.headers["set-cookie"][0]).not.toBe(cookie);

    // The old (rotated-out) refresh token cookie must no longer work.
    const reuseOld = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(reuseOld.status).toBe(401);
  });

  it("logs out and invalidates the refresh token", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASSWORD });
    const cookie = login.headers["set-cookie"][0];

    const logoutRes = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("logout is idempotent with no cookie", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(204);
  });

  it("rejects login for a deactivated user", async () => {
    await prisma.user.update({ where: { email: EMAIL }, data: { isActive: false } });
    const res = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(401);
    await prisma.user.update({ where: { email: EMAIL }, data: { isActive: true } });
  });
});
