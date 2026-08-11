import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireStaff, requireAdmin } from "../../common/middlewares/auth.js";
import * as studentsController from "./students.controller.js";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdParamsSchema,
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

studentsRouter.post(
  "/:id/confirm-profile",
  ...requireStaff,
  validate({ params: studentIdParamsSchema }),
  asyncHandler(studentsController.confirmProfile)
);

studentsRouter.patch(
  "/:id/workflow-status",
  ...requireAdmin,
  validate({ params: studentIdParamsSchema, body: updateWorkflowStatusBodySchema }),
  asyncHandler(studentsController.updateWorkflowStatus)
);
