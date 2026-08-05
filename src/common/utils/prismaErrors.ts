import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "../errors/AppError.js";

/** Converts known Prisma error codes into AppError subclasses, rethrows anything else. */
export function handlePrismaError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join(", ") : String(target ?? "field");
      throw new ConflictError(`A record with this ${fields} already exists`, { fields: target });
    }
    if (err.code === "P2025") {
      throw new NotFoundError("Record not found");
    }
  }
  throw err;
}
