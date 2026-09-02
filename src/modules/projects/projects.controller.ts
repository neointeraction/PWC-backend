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
  // Soft-delete — returns the project now flagged DELETED (was a 204 hard delete).
  const project = await projectsService.deleteProject(req.params.id as string);
  res.status(200).json(project);
}

export async function purgeProject(req: Request, res: Response): Promise<void> {
  // Hard delete — no body to return.
  await projectsService.purgeProject(req.params.id as string);
  res.status(204).send();
}

export async function restoreProject(req: Request, res: Response): Promise<void> {
  const project = await projectsService.restoreProject(req.params.id as string);
  res.status(200).json(project);
}
