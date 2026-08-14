import type { Request, Response } from "express";
import * as adminsService from "./admins.service.js";

export async function createAdmin(req: Request, res: Response): Promise<void> {
  const result = await adminsService.createAdmin(req.body);
  res.status(201).json(result);
}

export async function listAdmins(req: Request, res: Response): Promise<void> {
  const admins = await adminsService.listAdmins(req.query as never);
  res.status(200).json(admins);
}

export async function getAdmin(req: Request, res: Response): Promise<void> {
  const admin = await adminsService.getAdminById(req.params.id as string);
  res.status(200).json(admin);
}

export async function updateAdmin(req: Request, res: Response): Promise<void> {
  const admin = await adminsService.updateAdmin(req.params.id as string, req.body);
  res.status(200).json(admin);
}

export async function deleteAdmin(req: Request, res: Response): Promise<void> {
  await adminsService.deleteAdmin(req.params.id as string);
  res.status(204).send();
}
