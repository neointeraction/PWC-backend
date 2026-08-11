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
