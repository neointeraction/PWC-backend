import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { ForbiddenError, UnauthorizedError } from "../errors/AppError.js";

export interface AccessTokenPayload {
  sub: string; // User.id
  role: UserRole;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

// Verifies the `Authorization: Bearer <accessToken>` header and attaches the decoded
// payload to `req.user`. Not yet applied to any route — see CLAUDE.md "What's not
// built yet": every existing endpoint is still open. Wire this in per-module once
// role requirements for each route are confirmed, rather than blanket-applying it.
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = payload;
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError();
    }
    next();
  };
}

// --- Convenience middleware stacks (spread into a route's handler list) ---
//
// Role groupings (see docs/api-list.md "Authentication & roles"):
//   Staff = counsellors + admins (operational access)
//   Admin = admins + super admins (management: create/edit/delete, imports)
const STAFF_ROLES: UserRole[] = ["COUNSELLOR", "ADMIN", "SUPER_ADMIN"];
const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN"];
const STUDENT_OR_STAFF_ROLES: UserRole[] = ["STUDENT", ...STAFF_ROLES];

// Any authenticated user (student or staff), regardless of role.
export const requireAuth = [authenticate];
// Student self-service + staff (e.g. assessment attempts, session booking, own forms).
export const requireStudentOrStaff = [authenticate, requireRole(...STUDENT_OR_STAFF_ROLES)];
// Counsellor/admin operational endpoints.
export const requireStaff = [authenticate, requireRole(...STAFF_ROLES)];
// Admin/super-admin management endpoints.
export const requireAdmin = [authenticate, requireRole(...ADMIN_ROLES)];

// The two parent-filled form types. Parents have no login (they reach the form via a
// shared link), so these stay public — access is still bounded by the project window in
// the service layer. Every other form type is student-filled and requires a login.
export const PUBLIC_PARENT_FORM_TYPES = new Set(["PRE_COUNSELLING_PARENT", "FEEDBACK_PARENT"]);

// Forms routes are generic over `:formType`. Branch on it: parent forms are public;
// student forms require the student (or staff) to be authenticated. Used on the forms
// template + submission routes that carry a `:formType` param.
export function authenticateStudentForm(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PARENT_FORM_TYPES.has(String(req.params.formType ?? ""))) {
    next();
    return;
  }
  authenticate(req, res, () => {
    requireRole(...STUDENT_OR_STAFF_ROLES)(req, res, next);
  });
}
