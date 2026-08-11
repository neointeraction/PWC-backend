import type { Request, Response } from "express";
import * as counsellorsService from "./counsellors.service.js";
import type { AssignProjectBody } from "./counsellors.schema.js";

export async function createCounsellor(req: Request, res: Response): Promise<void> {
  const result = await counsellorsService.createCounsellor(req.body);
  res.status(201).json(result);
}

export async function listCounsellors(req: Request, res: Response): Promise<void> {
  const counsellors = await counsellorsService.listCounsellors(req.query as never);
  res.status(200).json(counsellors);
}

export async function getCounsellor(req: Request, res: Response): Promise<void> {
  const counsellor = await counsellorsService.getCounsellorById(req.params.id as string);
  res.status(200).json(counsellor);
}

export async function updateCounsellor(req: Request, res: Response): Promise<void> {
  const counsellor = await counsellorsService.updateCounsellor(req.params.id as string, req.body);
  res.status(200).json(counsellor);
}

export async function deleteCounsellor(req: Request, res: Response): Promise<void> {
  await counsellorsService.deleteCounsellor(req.params.id as string);
  res.status(204).send();
}

export async function assignProject(req: Request, res: Response): Promise<void> {
  const counsellor = await counsellorsService.assignProject(req.params.id as string, req.body as AssignProjectBody);
  res.status(200).json(counsellor);
}

export async function unassignProject(req: Request, res: Response): Promise<void> {
  const counsellor = await counsellorsService.unassignProject(
    req.params.id as string,
    req.params.projectId as string
  );
  res.status(200).json(counsellor);
}
