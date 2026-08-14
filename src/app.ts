import { fileURLToPath } from "node:url";
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
import { counsellorsRouter } from "./modules/counsellors/counsellors.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { cohortsRouter } from "./modules/cohorts/cohorts.routes.js";
import { formsRouter } from "./modules/forms/forms.routes.js";
import { assessmentRouter } from "./modules/assessment/assessment.routes.js";
import { careerLibraryRouter } from "./modules/career-library/career-library.routes.js";
import { counsellorChartRouter } from "./modules/counsellor-chart/counsellor-chart.routes.js";
import { feedbackRouter } from "./modules/feedback/feedback.routes.js";
import { sessionsRouter } from "./modules/sessions/sessions.routes.js";
import { emailRouter } from "./modules/email/email.routes.js";
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
  app.use("/api/v1/counsellors", counsellorsRouter);
  app.use("/api/v1/projects", projectsRouter);
  app.use("/api/v1/forms", formsRouter);
  app.use("/api/v1/assessment", assessmentRouter);
  app.use("/api/v1/career-library", careerLibraryRouter);
  app.use("/api/v1/counsellor-chart", counsellorChartRouter);
  app.use("/api/v1/feedback", feedbackRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/cohorts", cohortsRouter);
  app.use("/api/v1/sessions", sessionsRouter);
  app.use("/api/v1/email", emailRouter);
  app.use("/docs", docsRouter);

  // Dev/QA scoring-preview harness (same-origin, so it can call the API without CORS).
  // A single static page served only outside production — see public/assessment-tester.html.
  if (env.NODE_ENV !== "production") {
    const testerPath = fileURLToPath(new URL("../public/assessment-tester.html", import.meta.url));
    app.get("/dev/assessment", (_req, res) => {
      // The tester is a single self-contained page (inline script/style); drop helmet's
      // default CSP for just this dev route so the inline code runs.
      res.removeHeader("Content-Security-Policy");
      res.sendFile(testerPath);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
