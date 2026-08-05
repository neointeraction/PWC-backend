import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import type { ListCareerLibraryQuery } from "./career-library.schema.js";

export async function listCareerLibraryEntries(query: ListCareerLibraryQuery) {
  const where: Prisma.CareerLibraryEntryWhereInput = {
    status: query.status,
    cluster: query.cluster,
    industry: query.industry,
    domain: query.domain,
    aiResilienceGrade: query.aiResilienceGrade,
    ...(query.search
      ? {
          OR: [
            { jobRole: { contains: query.search, mode: "insensitive" } },
            { cluster: { contains: query.search, mode: "insensitive" } },
            { industry: { contains: query.search, mode: "insensitive" } },
            { domain: { contains: query.search, mode: "insensitive" } },
            { oneLineDescription: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.careerLibraryEntry.count({ where }),
    prisma.careerLibraryEntry.findMany({
      where,
      orderBy: [{ cluster: "asc" }, { jobRole: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: entries,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

// Distinct values for building filter dropdowns (Cluster / Industry / Domain / AI Grade).
export async function getCareerLibraryFilters() {
  const [clusters, industries, domains] = await Promise.all([
    prisma.careerLibraryEntry.findMany({
      where: { status: "ACTIVE" },
      distinct: ["cluster"],
      select: { cluster: true },
      orderBy: { cluster: "asc" },
    }),
    prisma.careerLibraryEntry.findMany({
      where: { status: "ACTIVE" },
      distinct: ["industry"],
      select: { industry: true },
      orderBy: { industry: "asc" },
    }),
    prisma.careerLibraryEntry.findMany({
      where: { status: "ACTIVE" },
      distinct: ["domain"],
      select: { domain: true },
      orderBy: { domain: "asc" },
    }),
  ]);

  return {
    clusters: clusters.map((c) => c.cluster),
    industries: industries.map((i) => i.industry),
    domains: domains.map((d) => d.domain),
    aiResilienceGrades: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"],
  };
}

// Detail view surfaces the cross-table mapping (see docs/db-design.md "Career Library
// workbook import"): related UG institutions by industry, UG courses by cluster, and
// UG entrance exams by the extracted exam-name list. Plain value matches, not FKs.
export async function getCareerLibraryEntryById(id: string) {
  const entry = await prisma.careerLibraryEntry.findUnique({ where: { id } });
  if (!entry) {
    throw new NotFoundError("Career library entry not found");
  }

  const [relatedInstitutions, relatedCourses, relatedEntranceExams] = await Promise.all([
    prisma.ugInstitution.findMany({
      where: { industry: entry.industry },
      orderBy: { name: "asc" },
    }),
    prisma.ugCourse.findMany({
      where: { careerCluster: entry.cluster },
      orderBy: { courseName: "asc" },
    }),
    entry.entranceExams.length > 0
      ? prisma.ugEntranceExam.findMany({
          where: { examName: { in: entry.entranceExams } },
          orderBy: { examName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return {
    ...entry,
    relatedInstitutions,
    relatedCourses,
    relatedEntranceExams,
  };
}
