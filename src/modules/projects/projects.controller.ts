import type { Request, Response } from "express";
import * as projectsService from "./projects.service.js";

export async function createProject(req: Request, res: Response): Promise<void> {
  const project = await projectsService.createProject(req.body);
  res.status(201).json(project);
}

export async function listProjects(req: Request, res: Response): Promise<void> {
  const projects = await projectsService.listProjects(req.query as never);
  res.status(200).json(projects);
}

export async function getProject(req: Request, res: Response): Promise<void> {
  const project = await projectsService.getProjectById(req.params.id as string);
  res.status(200).json(project);
}

export async function updateProject(req: Request, res: Response): Promise<void> {
  const project = await projectsService.updateProject(req.params.id as string, req.body);
  res.status(200).json(project);
}

export async function deleteProject(req: Request, res: Response): Promise<void> {
  await projectsService.deleteProject(req.params.id as string);
  res.status(204).send();
}
