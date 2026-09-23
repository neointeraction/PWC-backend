import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyReportPdfToken } from "../utils/reportPdfToken.js";
import { authenticate, STAFF_ROLES, type AccessTokenPayload } from "./auth.js";

// Guards GET .../students/:studentId report/chart reads. Two ways in:
//   - the normal Authorization: Bearer <access token> (student-self, via the same
//     ownership check as ownStudentParam, or any staff role);
//   - a short-lived report-pdf token (see reportPdfToken.ts), minted in-process by the
//     backend itself for its headless report-PDF render — parents have no login, and
//     that render happens server-to-server, not from a browser session.
// Deliberately does NOT set req.user for the report-pdf-token path: reports.controller's
// markReportDeliveredToStudent (which closes the case) only fires when req.user is a real
// STUDENT, and this internal render must never be mistaken for the student's own view.
export const authenticateReportRead = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      throw new UnauthorizedError("Missing or malformed Authorization header");
    }

    const pdfToken = verifyReportPdfToken(token);
    if (pdfToken) {
      if (pdfToken.studentId !== String(req.params.studentId)) {
        throw new ForbiddenError("This token isn't valid for this student's report");
      }
      next();
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    } catch {
      throw new UnauthorizedError("Invalid or expired access token");
    }
    req.user = payload;

    if (STAFF_ROLES.includes(payload.role)) {
      next();
      return;
    }
    if (payload.role !== "STUDENT") {
      throw new ForbiddenError();
    }
    const student = await prisma.student.findUnique({
      where: { id: String(req.params.studentId) },
      select: { userId: true },
    });
    if (!student) {
      throw new NotFoundError("Resource not found");
    }
    if (student.userId !== payload.sub) {
      throw new ForbiddenError("You can only access your own records");
    }
    next();
  }
);

// Guards static, non-student-scoped reference data the print render also needs (e.g. SCRI
// band guidance text) — a valid report-pdf token unlocks it too, alongside normal
// requireAuth, since there's no per-record ownership to check here.
export const authenticateStaticReadForReportPdf = asyncHandler(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (token && verifyReportPdfToken(token)) {
      next();
      return;
    }
    authenticate(req, res, next);
  }
);
