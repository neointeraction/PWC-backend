import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import type {
  CreateClusterInput,
  CreateDomainEducationInput,
  CreateDomainInput,
  CreateIndustryInput,
  ListClustersQuery,
  ListDomainEducationQuery,
  ListDomainsQuery,
  ListIndustriesQuery,
  UpdateClusterInput,
  UpdateDomainEducationInput,
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

// ======================= Education Path (domain-level) =======================

// Ordered by level then programme so the picker groups naturally (10+2 → Graduate → PG →
// certifications), matching the enum's declaration order.
const educationOrder = [{ level: "asc" }, { programme: "asc" }] as const;

export async function listDomainEducation(domainId: string, query: ListDomainEducationQuery) {
  await getLiveDomain(domainId); // 404 if the domain is missing/deleted
  return prisma.domainEducationEntry.findMany({
    where: {
      domainId,
      level: query.level,
      ...(query.includeDeleted ? {} : { deletedAt: null }),
    },
    orderBy: [...educationOrder],
  });
}

async function getLiveEducationEntry(entryId: string) {
  const entry = await prisma.domainEducationEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.deletedAt) throw new NotFoundError("Education path entry not found");
  return entry;
}

// Unique among *live* siblings only (same rule as the taxonomy levels), so a soft-deleted
// programme name can be reused. Same level + same programme in one domain is the clash.
async function assertEducationProgrammeFree(
  domainId: string,
  level: CreateDomainEducationInput["level"],
  programme: string,
  excludeId?: string
) {
  const clash = await prisma.domainEducationEntry.findFirst({
    where: { domainId, level, programme, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ConflictError("This programme already exists at that level for this domain");
}

export async function createDomainEducation(domainId: string, input: CreateDomainEducationInput) {
  await getLiveDomain(domainId);
  await assertEducationProgrammeFree(domainId, input.level, input.programme);
  return prisma.domainEducationEntry.create({
    data: {
      domainId,
      level: input.level,
      programme: input.programme,
      description: input.description,
    },
  });
}

export async function updateDomainEducation(entryId: string, input: UpdateDomainEducationInput) {
  const existing = await getLiveEducationEntry(entryId);
  const level = input.level ?? existing.level;
  const programme = input.programme ?? existing.programme;
  if (input.level !== undefined || input.programme !== undefined) {
    await assertEducationProgrammeFree(existing.domainId, level, programme, entryId);
  }
  return prisma.domainEducationEntry.update({
    where: { id: entryId },
    data: { level: input.level, programme: input.programme, description: input.description },
  });
}

// Soft delete, for the same reason the taxonomy levels are: the row leaves the domain's
// picker, but job roles already linked to it keep resolving and still render it.
export async function deleteDomainEducation(entryId: string) {
  await getLiveEducationEntry(entryId);
  return prisma.domainEducationEntry.update({
    where: { id: entryId },
    data: { deletedAt: new Date() },
  });
}

export async function restoreDomainEducation(entryId: string) {
  const entry = await prisma.domainEducationEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new NotFoundError("Education path entry not found");
  if (!entry.deletedAt) return entry;
  await assertEducationProgrammeFree(entry.domainId, entry.level, entry.programme, entryId);
  return prisma.domainEducationEntry.update({ where: { id: entryId }, data: { deletedAt: null } });
}
