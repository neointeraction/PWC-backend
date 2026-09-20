import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError.js";
import { env } from "../../config/env.js";

interface BodyParserError extends Error {
  status: number;
  type: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    err instanceof Error &&
    typeof (err as Partial<BodyParserError>).status === "number" &&
    typeof (err as Partial<BodyParserError>).type === "string" &&
    (err as BodyParserError).status >= 400 &&
    (err as BodyParserError).status < 500
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        message: "Validation failed",
        details: err.flatten(),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // body-parser (express.json) errors — malformed JSON (400), body over the size limit
  // (413), unsupported charset/encoding (415) — carry their own 4xx status. They're the
  // client's fault, so answer with that status instead of a 500.
  if (isBodyParserError(err)) {
    res.status(err.status).json({
      error: {
        message:
          err.type === "entity.parse.failed"
            ? "Request body is not valid JSON"
            : err.type === "entity.too.large"
              ? "Request body is too large"
              : err.message,
      },
    });
    return;
  }

  // The DB gave up on a transaction (P2028 timeout / P2034 write conflict-deadlock) or the
  // pool couldn't hand out a connection in time (P2024) — transient, worth a retry, and not
  // a bug in the request. Say so instead of a bare "Internal server error".
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2028" || err.code === "P2034" || err.code === "P2024")
  ) {
    console.error(err);
    res.status(503).json({
      error: { message: "The database is busy or the request took too long — please retry" },
    });
    return;
  }

  console.error(err);

  res.status(500).json({
    error: {
      message: "Internal server error",
      ...(env.NODE_ENV !== "production" && err instanceof Error
        ? { stack: err.stack }
        : {}),
    },
  });
}
