import { prisma } from "../../config/prisma.js";
import type { Actor } from "../career-library/career-library.service.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import type {
  CreateClusterInput,
  CreateDomainInput,
  CreateIndustryInput,
  ListClustersQuery,
  ListDomainsQuery,
  ListIndustriesQuery,
  UpdateClusterInput,
  UpdateDomainInput,
  UpdateIndustryInput,
} from "./career-taxonomy.schema.js";

// Name uniqueness is enforced here (not by a DB constraint) among *live* siblings only, so a
// soft-deleted name can be reused. `excludeId` skips the row being renamed/restored itself.

const industryInclude = { cluster: { select: { id: true, name: true } } } as const;
const domainInclude = {
  industry: { select: { id: true, name: true, cluster: { select: { id: true, name: true } } } },
} as const;

// ============================ Clusters ============================

export async function listClusters(query: ListClustersQuery) {
  return prisma.careerCluster.findMany({
    where: query.includeDeleted ? {} : { deletedAt: null },
    orderBy: { name: "asc" },
  });
}

async function getLiveCluster(id: string) {
  const cluster = await prisma.careerCluster.findUnique({ where: { id } });
  if (!cluster || cluster.deletedAt) throw new NotFoundError("Cluster not found");
  return cluster;
}

async function assertClusterNameFree(name: string, excludeId?: string) {
  const clash = await prisma.careerCluster.findFirst({
    where: { name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ConflictError("A cluster with this name already exists");
}

export async function createCluster(input: CreateClusterInput) {
  await assertClusterNameFree(input.name);
  return prisma.careerCluster.create({ data: { name: input.name } });
}

export async function updateCluster(id: string, input: UpdateClusterInput) {
  await getLiveCluster(id);
  if (input.name !== undefined) await assertClusterNameFree(input.name, id);
  return prisma.careerCluster.update({ where: { id }, data: { name: input.name } });
}

export async function deleteCluster(id: string) {
  await getLiveCluster(id);
  return prisma.careerCluster.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function restoreCluster(id: string) {
  const cluster = await prisma.careerCluster.findUnique({ where: { id } });
  if (!cluster) throw new NotFoundError("Cluster not found");
  if (!cluster.deletedAt) return cluster; // already live — idempotent
  await assertClusterNameFree(cluster.name, id);
  return prisma.careerCluster.update({ where: { id }, data: { deletedAt: null } });
}

// ============================ Industries ============================

export async function listIndustries(query: ListIndustriesQuery) {
  return prisma.careerIndustry.findMany({
    where: {
      clusterId: query.clusterId,
      // Default view hides soft-deleted industries and industries under a soft-deleted cluster.
      ...(query.includeDeleted ? {} : { deletedAt: null, cluster: { deletedAt: null } }),
    },
    include: industryInclude,
    orderBy: { name: "asc" },
  });
}

async function getLiveIndustry(id: string) {
  const industry = await prisma.careerIndustry.findUnique({ where: { id } });
  if (!industry || industry.deletedAt) throw new NotFoundError("Industry not found");
  return industry;
}

async function assertIndustryNameFree(clusterId: string, name: string, excludeId?: string) {
  const clash = await prisma.careerIndustry.findFirst({
    where: { clusterId, name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ConflictError("An industry with this name already exists in this cluster");
}

export async function createIndustry(input: CreateIndustryInput) {
  await getLiveCluster(input.clusterId); // 404 if the parent cluster is missing/deleted
  await assertIndustryNameFree(input.clusterId, input.name);
  return prisma.careerIndustry.create({
    data: { clusterId: input.clusterId, name: input.name },
    include: industryInclude,
  });
}

export async function updateIndustry(id: string, input: UpdateIndustryInput) {
  const existing = await getLiveIndustry(id);
  const clusterId = input.clusterId ?? existing.clusterId;
  if (input.clusterId && input.clusterId !== existing.clusterId) await getLiveCluster(input.clusterId);
  const name = input.name ?? existing.name;
  if (input.clusterId !== undefined || input.name !== undefined) {
    await assertIndustryNameFree(clusterId, name, id);
  }
  return prisma.careerIndustry.update({
    where: { id },
    data: { clusterId: input.clusterId, name: input.name },
    include: industryInclude,
  });
}

export async function deleteIndustry(id: string) {
  await getLiveIndustry(id);
  return prisma.careerIndustry.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: industryInclude,
  });
}

export async function restoreIndustry(id: string) {
  const industry = await prisma.careerIndustry.findUnique({ where: { id } });
  if (!industry) throw new NotFoundError("Industry not found");
  if (!industry.deletedAt) return prisma.careerIndustry.findUnique({ where: { id }, include: industryInclude });
  await assertIndustryNameFree(industry.clusterId, industry.name, id);
  return prisma.careerIndustry.update({
    where: { id },
    data: { deletedAt: null },
    include: industryInclude,
  });
}

// ============================ Domains ============================

export async function listDomains(query: ListDomainsQuery) {
  return prisma.careerDomain.findMany({
    where: {
      industryId: query.industryId,
      // Default view hides soft-deleted domains and domains whose industry/cluster is soft-deleted.
      ...(query.includeDeleted
        ? {}
        : { deletedAt: null, industry: { deletedAt: null, cluster: { deletedAt: null } } }),
    },
    include: domainInclude,
    orderBy: { name: "asc" },
  });
}

async function getLiveDomain(id: string) {
  const domain = await prisma.careerDomain.findUnique({ where: { id } });
  if (!domain || domain.deletedAt) throw new NotFoundError("Domain not found");
  return domain;
}

async function assertDomainNameFree(industryId: string, name: string, excludeId?: string) {
  const clash = await prisma.careerDomain.findFirst({
    where: { industryId, name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ConflictError("A domain with this name already exists in this industry");
}

export async function createDomain(input: CreateDomainInput) {
  await getLiveIndustry(input.industryId); // 404 if the parent industry is missing/deleted
  await assertDomainNameFree(input.industryId, input.name);
  return prisma.careerDomain.create({
    data: { industryId: input.industryId, name: input.name },
    include: domainInclude,
  });
}

export async function updateDomain(id: string, input: UpdateDomainInput) {
  const existing = await getLiveDomain(id);
  const industryId = input.industryId ?? existing.industryId;
  if (input.industryId && input.industryId !== existing.industryId) await getLiveIndustry(input.industryId);
  const name = input.name ?? existing.name;
  if (input.industryId !== undefined || input.name !== undefined) {
    await assertDomainNameFree(industryId, name, id);
  }
  return prisma.careerDomain.update({
    where: { id },
    data: { industryId: input.industryId, name: input.name },
    include: domainInclude,
  });
}

export async function deleteDomain(id: string) {
  await getLiveDomain(id);
  return prisma.careerDomain.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: domainInclude,
  });
}

export async function restoreDomain(id: string) {
  const domain = await prisma.careerDomain.findUnique({ where: { id } });
  if (!domain) throw new NotFoundError("Domain not found");
  if (!domain.deletedAt) return prisma.careerDomain.findUnique({ where: { id }, include: domainInclude });
  await assertDomainNameFree(domain.industryId, domain.name, id);
  return prisma.careerDomain.update({
    where: { id },
    data: { deletedAt: null },
    include: domainInclude,
  });
}

// ============================ Tree ============================

// Full live hierarchy (clusters → industries → domains) for the cascading picker on the
// "add job role" form.
export async function getTaxonomyTree() {
  return prisma.careerCluster.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      industries: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          domains: {
            where: { deletedAt: null },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          },
        },
      },
    },
  });
}

// Shared with the career-library module: assert a domainId points to a live domain (used when
// creating/updating a job role). Returns the domain row.
export async function assertLiveDomain(domainId: string) {
  const domain = await prisma.careerDomain.findUnique({
    where: { id: domainId },
    include: { industry: { select: { deletedAt: true, cluster: { select: { deletedAt: true } } } } },
  });
  if (!domain || domain.deletedAt || domain.industry.deletedAt || domain.industry.cluster.deletedAt) {
    throw new BadRequestError("domainId does not reference a live career domain");
  }
  return domain;
}
