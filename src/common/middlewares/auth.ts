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
//   VIEW_ONLY_ADMIN sits in the read guards (staff/student-or-staff) so it can SEE
//   everything, but is deliberately absent from ADMIN_ROLES, and every write it attempts
//   is rejected globally by `blockViewOnlyWrites` (mounted in app.ts).
const STAFF_ROLES: UserRole[] = ["COUNSELLOR", "ADMIN", "SUPER_ADMIN", "VIEW_ONLY_ADMIN"];
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
// Super-admin-only endpoints (e.g. managing App Admin accounts).
export const requireSuperAdmin = [authenticate, requireRole("SUPER_ADMIN")];

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

// Global read-only enforcement for VIEW_ONLY_ADMIN. Mounted once in app.ts AFTER the auth
// router (so login/refresh/logout/change-password still work) and before every resource
// router — a single choke point that blocks all mutations regardless of a route's own
// guard tier. It decodes the token itself (best-effort) so it doesn't depend on a route's
// `authenticate` having run yet; a missing/invalid token just falls through to the route's
// own guard (which will 401). Reads (GET/HEAD/OPTIONS) always pass.
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export function blockViewOnlyWrites(req: Request, _res: Response, next: NextFunction): void {
  if (READ_ONLY_METHODS.has(req.method)) {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice("Bearer ".length), env.JWT_ACCESS_SECRET) as AccessTokenPayload;
      if (payload.role === "VIEW_ONLY_ADMIN") {
        throw new ForbiddenError("View-only access: this account cannot make changes");
      }
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      // Invalid/expired token — let the route's own `authenticate` produce the 401.
    }
  }
  next();
}
