import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import * as studentsController from "./students.controller.js";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdParamsSchema,
  updateStudentSchema,
} from "./students.schema.js";

export const studentsRouter = Router();

studentsRouter.post(
  "/",
  validate({ body: createStudentSchema }),
  asyncHandler(studentsController.createStudent)
);

studentsRouter.get(
  "/",
  validate({ query: listStudentsQuerySchema }),
  asyncHandler(studentsController.listStudents)
);

studentsRouter.get(
  "/:id",
  validate({ params: studentIdParamsSchema }),
  asyncHandler(studentsController.getStudent)
);

studentsRouter.patch(
  "/:id",
  validate({ params: studentIdParamsSchema, body: updateStudentSchema }),
  asyncHandler(studentsController.updateStudent)
);

studentsRouter.delete(
  "/:id",
  validate({ params: studentIdParamsSchema }),
  asyncHandler(studentsController.deleteStudent)
);
