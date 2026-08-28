import type { Request, Response } from "express";
import * as service from "./career-taxonomy.service.js";

// ---- Clusters ----
export async function listClusters(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listClusters(req.query as never));
}
export async function createCluster(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createCluster(req.body));
}
export async function updateCluster(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateCluster(req.params.id as string, req.body));
}
export async function deleteCluster(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.deleteCluster(req.params.id as string));
}
export async function restoreCluster(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.restoreCluster(req.params.id as string));
}

// ---- Industries ----
export async function listIndustries(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listIndustries(req.query as never));
}
export async function createIndustry(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createIndustry(req.body));
}
export async function updateIndustry(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateIndustry(req.params.id as string, req.body));
}
export async function deleteIndustry(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.deleteIndustry(req.params.id as string));
}
export async function restoreIndustry(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.restoreIndustry(req.params.id as string));
}

// ---- Domains ----
export async function listDomains(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listDomains(req.query as never));
}
export async function createDomain(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createDomain(req.body));
}
export async function updateDomain(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateDomain(req.params.id as string, req.body));
}
export async function deleteDomain(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.deleteDomain(req.params.id as string));
}
export async function restoreDomain(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.restoreDomain(req.params.id as string));
}

// ---- Tree ----
export async function getTree(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getTaxonomyTree());
}

// ---- Education Path (domain-level) ----
export async function listDomainEducation(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listDomainEducation(req.params.id as string, req.query as never));
}
export async function createDomainEducation(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createDomainEducation(req.params.id as string, req.body));
}
export async function updateDomainEducation(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateDomainEducation(req.params.entryId as string, req.body));
}
export async function deleteDomainEducation(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.deleteDomainEducation(req.params.entryId as string));
}
export async function restoreDomainEducation(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.restoreDomainEducation(req.params.entryId as string));
}
