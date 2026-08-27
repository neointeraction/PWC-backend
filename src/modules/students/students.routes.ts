import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin, requireStudentOrStaff } from "../../common/middlewares/auth.js";
import { ownStudentIdParam } from "../../common/middlewares/ownership.js";
import * as studentsController from "./students.controller.js";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdParamsSchema,
  updateMyStudentSchema,
  updateStudentSchema,
  updateWorkflowStatusBodySchema,
} from "./students.schema.js";

export const studentsRouter = Router();

// Reads = staff; create/edit/delete + workflow override = admin (management).
studentsRouter.post(
  "/",
  ...requireAdmin,
  validate({ body: createStudentSchema }),
  asyncHandler(studentsController.createStudent)
);

studentsRouter.get(
  "/",
  ...requireStaff,
  validate({ query: listStudentsQuerySchema }),
  asyncHandler(studentsController.listStudents)
);

// Student self-service: the logged-in student's own record. Declared before "/:id" so
// "me" isn't parsed as an id. Staff may call it too (they'll just 404 — no Student row).
studentsRouter.get(
  "/me",
  ...requireStudentOrStaff,
  asyncHandler(studentsController.getMyStudent)
);

// Student self-service edit: the logged-in student updates their own parent/guardian
// details + WhatsApp number (narrow field set — identity/enrolment stays admin-only).
// Resolves the Student row from the token, so no id param or ownership guard is needed.
studentsRouter.patch(
  "/me",
  ...requireStudentOrStaff,
  validate({ body: updateMyStudentSchema }),
  asyncHandler(studentsController.updateMyStudent)
);

studentsRouter.get(
  "/:id",
  ...requireStaff,
  validate({ params: studentIdParamsSchema }),
  asyncHandler(studentsController.getStudent)
);

studentsRouter.patch(
  "/:id",
  ...requireAdmin,
  validate({ params: studentIdParamsSchema, body: updateStudentSchema }),
  asyncHandler(studentsController.updateStudent)
);

studentsRouter.delete(
  "/:id",
  ...requireAdmin,
  validate({ params: studentIdParamsSchema }),
  asyncHandler(studentsController.deleteStudent)
);

// Student-facing: the student confirms their own profile (or staff on their behalf),
// advancing the workflow DRAFT -> PROFILE_COMPLETED. Ownership-checked for students.
studentsRouter.post(
  "/:id/confirm-profile",
  ...requireStudentOrStaff,
  validate({ params: studentIdParamsSchema }),
  ownStudentIdParam,
  asyncHandler(studentsController.confirmProfile)
);

studentsRouter.patch(
  "/:id/workflow-status",
  ...requireAdmin,
  validate({ params: studentIdParamsSchema, body: updateWorkflowStatusBodySchema }),
  asyncHandler(studentsController.updateWorkflowStatus)
);
