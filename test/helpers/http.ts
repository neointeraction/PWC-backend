import supertest from "supertest";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import type { UserRole } from "@prisma/client";

const SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret";

// Signs a valid access token for tests. `authenticate` only verifies the signature and
// reads role/sub off the payload — it doesn't hit the DB — so a signed token is enough
// to exercise the route guards without seeding a real User (unless a test needs the
// `sub` to match a specific student.userId for future ownership checks).
export function bearer(
  role: UserRole = "ADMIN",
  opts: { userId?: string; email?: string } = {}
): string {
  const token = jwt.sign(
    { sub: opts.userId ?? `test-${role.toLowerCase()}`, role, email: opts.email ?? `${role.toLowerCase()}@test.local` },
    SECRET,
    { expiresIn: "15m" }
  );
  return `Bearer ${token}`;
}

type Method = "get" | "post" | "put" | "patch" | "delete";

// A supertest wrapper that attaches an Authorization header to every request. Drop-in
// for `request(app)`: `authRequest(app).post(url).send(...)`. Defaults to an ADMIN token
// (admins pass every guard), so existing tests keep working with a one-line swap. Pass a
// role to test role-specific access, e.g. `authRequest(app, "STUDENT")`.
export function authRequest(
  app: Express,
  role: UserRole = "ADMIN",
  opts: { userId?: string; email?: string } = {}
): Record<Method, (url: string) => supertest.Test> {
  const token = bearer(role, opts);
  const wrap = (m: Method) => (url: string) => supertest(app)[m](url).set("Authorization", token);
  return { get: wrap("get"), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), delete: wrap("delete") };
}
