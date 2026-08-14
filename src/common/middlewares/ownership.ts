import type { Request } from "express";
import { prisma } from "../../config/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors/AppError.js";
import { PUBLIC_PARENT_FORM_TYPES } from "./auth.js";

// Per-record ownership: a STUDENT may only act on their own records; staff (counsellor /
// admin / super admin) bypass the check. These run AFTER `requireStudentOrStaff` (or, for
// forms, `authenticateStudentForm`), so `req.user` is present and is a student or staff.
//
// The access token's `sub` is the User.id; a Student row links to it via `Student.userId`.
// Each guard resolves the *owning* student's userId from the request and compares.

// VIEW_ONLY_ADMIN included so it can READ any student's records (its writes are blocked
// globally by blockViewOnlyWrites regardless).
const STAFF_ROLES = new Set(["COUNSELLOR", "ADMIN", "SUPER_ADMIN", "VIEW_ONLY_ADMIN"]);

// A resolver returns the userId of the student who owns the targeted record, or null if
// no such record exists (→ 404, which also avoids leaking existence to other students).
type OwnerResolver = (req: Request) => Promise<string | null>;

function selfOrStaff(resolve: OwnerResolver) {
  return asyncHandler(async (req, _res, next) => {
    const user = req.user;
    if (!user) throw new UnauthorizedError();
    if (STAFF_ROLES.has(user.role)) {
      next();
      return;
    }
    // Role is STUDENT (the preceding role guard guarantees student-or-staff).
    const ownerUserId = await resolve(req);
    if (ownerUserId == null) {
      throw new NotFoundError("Resource not found");
    }
    if (ownerUserId !== user.sub) {
      throw new ForbiddenError("You can only access your own records");
    }
    next();
  });
}

async function studentUserId(studentId: string): Promise<string | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { userId: true },
  });
  return student?.userId ?? null;
}

// `:studentId` route param (forms status, session booking).
export const ownStudentParam = selfOrStaff((req) => studentUserId(String(req.params.studentId)));

// `studentId` in the request body (assessment attempt creation).
export const ownStudentBody = selfOrStaff((req) => studentUserId(String((req.body as { studentId?: string }).studentId ?? "")));

// `:attemptId` route param → the attempt's student (assessment answer/submit/result).
export const ownAttemptParam = selfOrStaff(async (req) => {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: String(req.params.attemptId) },
    select: { student: { select: { userId: true } } },
  });
  return attempt?.student.userId ?? null;
});

// `:id` route param → the session's student (session join / reschedule / cancel).
export const ownSessionParam = selfOrStaff(async (req) => {
  const session = await prisma.session.findUnique({
    where: { id: String(req.params.id) },
    select: { student: { select: { userId: true } } },
  });
  return session?.student.userId ?? null;
});

// Forms routes are generic over `:formType`. Parent forms are public (no owner to check);
// student forms carry a `:studentId` and must be owned by the caller (or staff).
export const ownStudentForm = asyncHandler(async (req, _res, next) => {
  if (PUBLIC_PARENT_FORM_TYPES.has(String(req.params.formType))) {
    next();
    return;
  }
  const user = req.user;
  if (!user) throw new UnauthorizedError();
  if (STAFF_ROLES.has(user.role)) {
    next();
    return;
  }
  const ownerUserId = await studentUserId(String(req.params.studentId));
  if (ownerUserId == null) {
    throw new NotFoundError("Resource not found");
  }
  if (ownerUserId !== user.sub) {
    throw new ForbiddenError("You can only access your own records");
  }
  next();
});
