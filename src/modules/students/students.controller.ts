import type { Request, Response } from "express";
import * as studentsService from "./students.service.js";

export async function createStudent(req: Request, res: Response): Promise<void> {
  const result = await studentsService.createStudent(req.body);
  res.status(201).json(result);
}

export async function listStudents(req: Request, res: Response): Promise<void> {
  const students = await studentsService.listStudents(req.query as never);
  res.status(200).json(students);
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
