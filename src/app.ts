import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./common/middlewares/errorHandler.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { institutesRouter } from "./modules/institutes/institutes.routes.js";
import { studentsRouter } from "./modules/students/students.routes.js";
import { formsRouter } from "./modules/forms/forms.routes.js";
import { assessmentRouter } from "./modules/assessment/assessment.routes.js";
import { docsRouter } from "./modules/docs/docs.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/institutes", institutesRouter);
  app.use("/api/v1/students", studentsRouter);
  app.use("/api/v1/forms", formsRouter);
  app.use("/api/v1/assessment", assessmentRouter);
  app.use("/docs", docsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
