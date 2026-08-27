import crypto from "node:crypto";
import argon2 from "argon2";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import type { CreateAdminInput, ListAdminsQuery, UpdateAdminInput } from "./admins.schema.js";

// This module only ever touches App Admin accounts — never students, counsellors, or the
// super admin. Every read/write is scoped to these roles.
const APP_ADMIN_ROLES: UserRole[] = ["ADMIN", "VIEW_ONLY_ADMIN"];

const adminSelect = {
  id: true,
  email: true,
  role: true,
  firstName: true,
  lastName: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export async function createAdmin(input: CreateAdminInput) {
  const tempPassword = generateTempPassword();
  const passwordHash = await argon2.hash(tempPassword);
  try {
    const admin = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
      },
      select: adminSelect,
    });
    return { admin, tempPassword };
  } catch (err) {
    handlePrismaError(err); // P2002 on email → 409
  }
}

export async function listAdmins(query: ListAdminsQuery) {
  return prisma.user.findMany({
    where: { role: query.role ?? { in: APP_ADMIN_ROLES } },
    select: adminSelect,
    orderBy: { createdAt: "desc" },
  });
}

// Scoped to App Admin roles — fetching a student/counsellor/super-admin id here 404s, so
// this module can't be used to read or mutate any non-admin user.
export async function getAdminById(id: string) {
  const admin = await prisma.user.findFirst({
    where: { id, role: { in: APP_ADMIN_ROLES } },
    select: adminSelect,
  });
  if (!admin) {
    throw new NotFoundError("App admin not found");
  }
  return admin;
}

export async function updateAdmin(id: string, input: UpdateAdminInput) {
  await getAdminById(id); // 404 unless it's an App Admin
  try {
    return await prisma.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role, // ADMIN <-> VIEW_ONLY_ADMIN (schema forbids other roles)
        isActive: input.isActive,
      },
      select: adminSelect,
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

// Super Admin mints a fresh temporary password for an App Admin. Returns the new
// plaintext password ONCE (never stored in the clear) so it can be shown/copied, and
// flags mustChangePassword so it's treated as a temporary credential.
export async function regenerateAdminPassword(id: string) {
  await getAdminById(id); // 404 unless it's an App Admin
  const tempPassword = generateTempPassword();
  const passwordHash = await argon2.hash(tempPassword);
  const admin = await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
    select: adminSelect,
  });
  return { admin, tempPassword };
}

export async function deleteAdmin(id: string) {
  await getAdminById(id); // 404 unless it's an App Admin
  // App admins own no dependent records (no Student/Counsellor profile); their refresh /
  // password-reset tokens cascade. createdBy/updatedBy references elsewhere are plain
  // string labels, not FKs, so this is safe.
  await prisma.user.delete({ where: { id } });
}
