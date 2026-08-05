import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate<T extends ValidationSchemas>(schemas: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body) as z.infer<
        NonNullable<T["body"]>
      >;
    }
    if (schemas.query) {
      req.query = schemas.query.parse(req.query) as never;
    }
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as never;
    }
    next();
  };
}
