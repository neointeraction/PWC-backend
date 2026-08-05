import type { Request, Response } from "express";
import * as institutesService from "./institutes.service.js";

export async function createInstitute(req: Request, res: Response): Promise<void> {
  const institute = await institutesService.createInstitute(req.body);
  res.status(201).json(institute);
}

export async function listInstitutes(_req: Request, res: Response): Promise<void> {
  const institutes = await institutesService.listInstitutes();
  res.status(200).json(institutes);
}

export async function getInstitute(req: Request, res: Response): Promise<void> {
  const institute = await institutesService.getInstituteById(req.params.id as string);
  res.status(200).json(institute);
}

export async function updateInstitute(req: Request, res: Response): Promise<void> {
  const institute = await institutesService.updateInstitute(req.params.id as string, req.body);
  res.status(200).json(institute);
}

export async function deleteInstitute(req: Request, res: Response): Promise<void> {
  await institutesService.deleteInstitute(req.params.id as string);
  res.status(204).send();
}

export async function createInstituteClass(req: Request, res: Response): Promise<void> {
  const instituteClass = await institutesService.createInstituteClass(
    req.params.id as string,
    req.body
  );
  res.status(201).json(instituteClass);
}

export async function listInstituteClasses(req: Request, res: Response): Promise<void> {
  const classes = await institutesService.listInstituteClasses(req.params.id as string);
  res.status(200).json(classes);
}

export async function createInstituteDivision(req: Request, res: Response): Promise<void> {
  const division = await institutesService.createInstituteDivision(
    req.params.id as string,
    req.params.classId as string,
    req.body
  );
  res.status(201).json(division);
}

export async function listInstituteDivisions(req: Request, res: Response): Promise<void> {
  const divisions = await institutesService.listInstituteDivisions(
    req.params.id as string,
    req.params.classId as string
  );
  res.status(200).json(divisions);
}
