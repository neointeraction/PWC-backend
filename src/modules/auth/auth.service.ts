import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { User } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { BadRequestError, UnauthorizedError } from "../../common/errors/AppError.js";
import { parseDurationMs } from "../../common/utils/duration.js";
import type { AccessTokenPayload } from "../../common/middlewares/auth.js";
import { sendTemplateEmail } from "../email/email.service.js";
import type { ChangePasswordBody, LoginBody } from "./auth.schema.js";

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
  // Login timestamp for the admin "Last Active" column. Only a real password login
  // updates it — token refreshes don't, so it reflects deliberate sign-ins.
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

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

// Revokes every live refresh token for a user — used after a password change/reset so
// other sessions can't keep refreshing with the old credentials.
async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Authenticated password change (user knows their current password). Clears the
// first-login `mustChangePassword` flag and logs out all other sessions.
export async function changePassword(userId: string, input: ChangePasswordBody): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError();
  }

  const currentValid = await argon2.verify(user.passwordHash, input.currentPassword);
  if (!currentValid) {
    throw new BadRequestError("Current password is incorrect");
  }
  if (await argon2.verify(user.passwordHash, input.newPassword)) {
    throw new BadRequestError("New password must be different from the current password");
  }

  const passwordHash = await argon2.hash(input.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });
  await revokeAllRefreshTokens(userId);
}

// Forgot-password step 1: mint a single-use reset token and email its link. Always
// resolves the same way whether or not the email exists, so it can't be used to probe
// which emails have accounts. Returns the raw token for internal/testing use only — the
// controller never puts it in the HTTP response.
export async function forgotPassword(email: string): Promise<{ rawToken: string | null }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return { rawToken: null };
  }

  const rawToken = crypto.randomBytes(40).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + parseDurationMs(env.PASSWORD_RESET_EXPIRES_IN)),
    },
  });

  const resetLink = `${env.APP_WEB_URL}/reset-password?token=${rawToken}`;
  await sendTemplateEmail(user.email, "PASSWORD_RESET", {
    name: user.firstName,
    resetLink,
    expiresInText: env.PASSWORD_RESET_EXPIRES_IN,
  });

  return { rawToken };
}

// Forgot-password step 2: consume a valid reset token and set the new password. Marks
// the token used (single-use), clears `mustChangePassword`, and logs out all sessions.
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw new BadRequestError("Invalid or expired reset token");
  }

  const passwordHash = await argon2.hash(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash, mustChangePassword: false },
    }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllRefreshTokens(stored.userId);
}
