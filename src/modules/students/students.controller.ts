import type { Request, Response } from "express";
import * as studentsService from "./students.service.js";
import type {
  CheckDuplicateStudentsBody,
  DiscontinueStudentBody,
  UpdateWorkflowStatusBody,
} from "./students.schema.js";

export async function createStudent(req: Request, res: Response): Promise<void> {
  const result = await studentsService.createStudent(req.body);
  res.status(201).json(result);
}

export async function checkDuplicateStudents(req: Request, res: Response): Promise<void> {
  const results = await studentsService.checkDuplicateStudents(req.body as CheckDuplicateStudentsBody);
  res.status(200).json({ results });
}

export async function listStudents(req: Request, res: Response): Promise<void> {
  const students = await studentsService.listStudents(req.query as never);
  res.status(200).json(students);
}

export async function getMyStudent(req: Request, res: Response): Promise<void> {
  const student = await studentsService.getStudentByUserId(req.user!.sub);
  res.status(200).json(student);
}

export async function updateMyStudent(req: Request, res: Response): Promise<void> {
  const student = await studentsService.updateMyStudent(req.user!.sub, req.body);
  res.status(200).json(student);
}

export async function getStudent(req: Request, res: Response): Promise<void> {
  const student = await studentsService.getStudentById(req.params.id as string);
  res.status(200).json(student);
}

export async function updateStudent(req: Request, res: Response): Promise<void> {
  const student = await studentsService.updateStudent(req.params.id as string, req.body);
  res.status(200).json(student);
}

export async function deleteStudent(req: Request, res: Response): Promise<void> {
  await studentsService.deleteStudent(req.params.id as string);
  res.status(204).send();
}

export async function confirmProfile(req: Request, res: Response): Promise<void> {
  const student = await studentsService.confirmProfile(req.params.id as string);
  res.status(200).json(student);
}

export async function updateWorkflowStatus(req: Request, res: Response): Promise<void> {
  const { workflowStatus } = req.body as UpdateWorkflowStatusBody;
  const student = await studentsService.setWorkflowStatus(req.params.id as string, workflowStatus);
  res.status(200).json(student);
}

export async function discontinueStudent(req: Request, res: Response): Promise<void> {
  const { reason } = req.body as DiscontinueStudentBody;
  const student = await studentsService.discontinueStudent(req.params.id as string, reason);
  res.status(200).json(student);
}

export async function reinstateStudent(req: Request, res: Response): Promise<void> {
  const student = await studentsService.reinstateStudent(req.params.id as string);
  res.status(200).json(student);
}
