import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { User } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { parseDurationMs } from "../../common/utils/duration.js";
import type { AccessTokenPayload } from "../../common/middlewares/auth.js";
import type { LoginBody } from "./auth.schema.js";

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function signAccessToken(user: Pick<User, "id" | "role" | "email">): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role, email: user.email };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions);
}

async function issueRefreshToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString("hex");
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId,
      expiresAt: new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRES_IN)),
    },
  });
  return rawToken;
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function login(input: LoginBody) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const passwordValid = await argon2.verify(user.passwordHash, input.password);
  if (!passwordValid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);

  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function refresh(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }
  if (!stored.user.isActive) {
    throw new UnauthorizedError("Account is disabled");
  }

  // Rotate: revoke the presented token, issue a fresh pair. Limits the blast radius of
  // a leaked refresh token to a single use.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const accessToken = signAccessToken(stored.user);
  const refreshToken = await issueRefreshToken(stored.userId);

  return { accessToken, refreshToken, user: toPublicUser(stored.user) };
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt) {
    return; // idempotent — already logged out / unknown token, nothing to do
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
}
