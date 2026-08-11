import argon2 from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import * as authService from "../src/modules/auth/auth.service.js";

const app = createApp();

const CHANGE_EMAIL = "pwd-change@test-authpwd.example";
const RESET_EMAIL = "pwd-reset@test-authpwd.example";
const ORIGINAL = "original-password-1";

async function seedUser(email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) await prisma.user.delete({ where: { id: existing.id } });
  await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(ORIGINAL),
      role: "SUPER_ADMIN",
      firstName: "Pwd",
      lastName: "Tester",
      mustChangePassword: true,
    },
  });
}

async function accessTokenFor(email: string, password: string): Promise<{ token: string; cookie: string }> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  return { token: res.body.accessToken as string, cookie: res.headers["set-cookie"][0] };
}

describe("Auth — change password", () => {
  beforeAll(() => seedUser(CHANGE_EMAIL));
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: CHANGE_EMAIL } });
  });

  it("401s without a token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: ORIGINAL, newPassword: "brand-new-password" });
    expect(res.status).toBe(401);
  });

  it("400s a too-short new password", async () => {
    const { token } = await accessTokenFor(CHANGE_EMAIL, ORIGINAL);
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: ORIGINAL, newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("400s a wrong current password", async () => {
    const { token } = await accessTokenFor(CHANGE_EMAIL, ORIGINAL);
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "not-my-password", newPassword: "brand-new-password" });
    expect(res.status).toBe(400);
  });

  it("changes the password, clears mustChangePassword, and revokes old sessions", async () => {
    const { token, cookie } = await accessTokenFor(CHANGE_EMAIL, ORIGINAL);

    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: ORIGINAL, newPassword: "brand-new-password" });
    expect(res.status).toBe(204);

    // Old password no longer works; new one does.
    const oldLogin = await request(app).post("/api/v1/auth/login").send({ email: CHANGE_EMAIL, password: ORIGINAL });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/api/v1/auth/login").send({ email: CHANGE_EMAIL, password: "brand-new-password" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);

    // The refresh session held before the change was revoked.
    const refreshOld = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(refreshOld.status).toBe(401);
  });
});

describe("Auth — forgot/reset password", () => {
  beforeAll(() => seedUser(RESET_EMAIL));
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: RESET_EMAIL } });
    await prisma.$disconnect();
  });

  it("202s the forgot-password request without leaking whether the email exists", async () => {
    const known = await request(app).post("/api/v1/auth/forgot-password").send({ email: RESET_EMAIL });
    expect(known.status).toBe(202);
    const unknown = await request(app).post("/api/v1/auth/forgot-password").send({ email: "nobody@test-authpwd.example" });
    expect(unknown.status).toBe(202); // same response — no account enumeration
  });

  it("400s a reset with an invalid token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "reset-password-123" });
    expect(res.status).toBe(400);
  });

  it("resets the password with a valid single-use token", async () => {
    // Mint a token via the service (the raw token is only ever emailed, never returned
    // over HTTP), then drive the public reset endpoint with it.
    const { rawToken } = await authService.forgotPassword(RESET_EMAIL);
    expect(rawToken).toBeTypeOf("string");

    const reset = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: rawToken, newPassword: "reset-password-123" });
    expect(reset.status).toBe(204);

    // New password works; old one doesn't.
    const newLogin = await request(app).post("/api/v1/auth/login").send({ email: RESET_EMAIL, password: "reset-password-123" });
    expect(newLogin.status).toBe(200);
    const oldLogin = await request(app).post("/api/v1/auth/login").send({ email: RESET_EMAIL, password: ORIGINAL });
    expect(oldLogin.status).toBe(401);

    // Token is single-use.
    const reuse = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: rawToken, newPassword: "another-password-123" });
    expect(reuse.status).toBe(400);
  });
});
