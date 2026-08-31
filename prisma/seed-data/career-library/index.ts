import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const DIR = dirname(fileURLToPath(import.meta.url));

// Data source: "docs/Career Library_Updated_1808.xlsx", exported to JSON by
// scripts/export-career-library.py (rerun that script if the workbook changes).
const IMPORT_LABEL = "seed:career-library-import";

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DIR, filename), "utf-8")) as T;
}

interface CareerLibraryRow {
  cluster: string;
  industry: string;
  domain: string;
  jobRole: string;
  aiResilienceGrade: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  aiResilienceComment: string;
  oneLineDescription: string;
  roleOverview: string | null;
  keySkills: string[];
  topCompanies: string[];
  salaryIndiaRangeText: string | null;
  salaryIndiaMinLPA: number | null;
  salaryIndiaMaxLPA: number | null;
  salaryGlobalRangeText: string | null;
  salaryGlobalMinUSD: number | null;
  salaryGlobalMaxUSD: number | null;
  qualification10th12th: string;
  qualification10th12thExplanation: string | null;
  qualificationGraduation: string | null;
  qualificationGraduationDefined: string | null;
  entranceExamsUGDescription: string | null;
  entranceExams: string[];
  qualificationPG: string | null;
  qualificationPGDefined: string | null;
  entranceExamsPG: string[];
  certificationsStudent: string[];
  certificationsUG: string[];
  topCourses: string[];
}

interface UgInstitutionRow {
  industry: string;
  shortName: string | null;
  name: string;
  city: string | null;
  state: string | null;
  type: string | null;
  category: string | null;
  programmesOffered: string | null;
  programmesOfferedAfterClass12: string | null;
  keyProgrammesOffered: string | null;
  primaryEntranceExams: string | null;
  nirfRanking: string | null;
  otherRankings: string | null;
  approxAnnualFee: string | null;
  approxPlacementCtc: string | null;
  website: string | null;
}

interface UgInstitutionUniversityRow {
  shortName: string | null;
  name: string;
  city: string | null;
  state: string | null;
  type: string | null;
  category: string | null;
  keyProgrammesOffered: string | null;
  primaryEntranceExams: string | null;
  nirfRanking: string | null;
  otherRankings: string | null;
  approxAnnualFee: string | null;
  approxPlacementCtc: string | null;
  website: string | null;
}

interface UgEntranceExamRow {
  examName: string;
  fullForm: string | null;
  conductingBody: string | null;
  level: string | null;
  applicableFor: string | null;
  subjectRequirements12th: string | null;
  applicationWindow: string | null;
  examMonth: string | null;
  resultMonth: string | null;
  examMode: string | null;
  frequency: string | null;
  approxAttemptsAllowed: string | null;
  officialWebsite: string | null;
}

interface UgCourseRow {
  courseName: string;
  fullForm: string | null;
  level: string | null;
  durationYears: string | null;
  careerCluster: string;
  stream12thRequirements: string | null;
  minimumEligibility: string | null;
  entranceExamsPrimary: string | null;
  entranceExamsAlternate: string | null;
  topSpecialisations: string | null;
  topGovtColleges: string | null;
  topPrivateColleges: string | null;
  approxAnnualFeeRange: string | null;
  furtherStudyOptions: string | null;
}

interface PgInstitutionRow {
  industry: string | null;
  institution: string;
  state: string | null;
  city: string | null;
  programTypes: string | null;
  website: string | null;
}

interface PgEntranceExamRow {
  examName: string;
  coursesForExam: string | null;
  officialWebsite: string | null;
}

export async function seedCareerLibraryData(prisma: PrismaClient): Promise<void> {
  const careerLibrary = loadJson<CareerLibraryRow[]>("career-library.json");
  const ugInstitutions = loadJson<UgInstitutionRow[]>("ug-institutions.json");
  const ugInstitutionsUniversities = loadJson<UgInstitutionUniversityRow[]>(
    "ug-institutions-universities.json"
  );
  const ugEntranceExams = loadJson<UgEntranceExamRow[]>("ug-entrance-exams.json");
  const ugCourses = loadJson<UgCourseRow[]>("ug-courses.json");
  const pgInstitutions = loadJson<PgInstitutionRow[]>("pg-institutions.json");
  const pgEntranceExams = loadJson<PgEntranceExamRow[]>("pg-entrance-exams.json");

  // Replace, not upsert — this is a bulk reference-data import with no natural
  // per-row unique key, so each run clears and reinserts from the latest export.
  await prisma.careerLibraryEntry.deleteMany({});
  // Taxonomy, deleted after the entries that reference it (domain → industry → cluster).
  await prisma.careerDomain.deleteMany({});
  await prisma.careerIndustry.deleteMany({});
  await prisma.careerCluster.deleteMany({});
  await prisma.ugInstitution.deleteMany({});
  await prisma.ugInstitutionUniversity.deleteMany({});
  await prisma.ugEntranceExam.deleteMany({});
  await prisma.ugCourse.deleteMany({});
  await prisma.pgInstitution.deleteMany({});
  await prisma.pgEntranceExam.deleteMany({});

  // Build the taxonomy (Cluster → Industry → Domain) from the rows' classification columns.
  // Raw (untrimmed) values are used as keys so the distinct sets match the migration's backfill
  // (13 clusters / 43 industries / 571 domains). Domain names repeat across industries, so a
  // domain is keyed by (industryId, name), not name alone.
  const clusterNames = [...new Set(careerLibrary.map((r) => r.cluster))];
  await prisma.careerCluster.createMany({ data: clusterNames.map((name) => ({ name })) });
  const clusterId = new Map(
    (await prisma.careerCluster.findMany({ select: { id: true, name: true } })).map((c) => [c.name, c.id])
  );

  const industryPairs = [
    ...new Map(careerLibrary.map((r) => [`${r.cluster}||${r.industry}`, r])).values(),
  ];
  await prisma.careerIndustry.createMany({
    data: industryPairs.map((r) => ({ clusterId: clusterId.get(r.cluster)!, name: r.industry })),
  });
  const industryId = new Map(
    (await prisma.careerIndustry.findMany({ select: { id: true, clusterId: true, name: true } })).map((i) => [
      `${i.clusterId}||${i.name}`,
      i.id,
    ])
  );

  const domainTriples = [
    ...new Map(careerLibrary.map((r) => [`${r.cluster}||${r.industry}||${r.domain}`, r])).values(),
  ];
  await prisma.careerDomain.createMany({
    data: domainTriples.map((r) => ({
      industryId: industryId.get(`${clusterId.get(r.cluster)!}||${r.industry}`)!,
      name: r.domain,
    })),
  });
  const domainId = new Map(
    (await prisma.careerDomain.findMany({ select: { id: true, industryId: true, name: true } })).map((d) => [
      `${d.industryId}||${d.name}`,
      d.id,
    ])
  );

  // Resolve a row's leaf domainId by walking cluster → industry → domain.
  const resolveDomainId = (row: CareerLibraryRow): string => {
    const cId = clusterId.get(row.cluster)!;
    const iId = industryId.get(`${cId}||${row.industry}`)!;
    return domainId.get(`${iId}||${row.domain}`)!;
  };

  await prisma.careerLibraryEntry.createMany({
    data: careerLibrary.map(({ cluster: _c, industry: _i, domain: _d, ...rest }) => ({
      ...rest,
      domainId: resolveDomainId({ cluster: _c, industry: _i, domain: _d, ...rest }),
      status: "ACTIVE",
      createdBy: IMPORT_LABEL,
    })),
  });
  await prisma.ugInstitution.createMany({ data: ugInstitutions });
  await prisma.ugInstitutionUniversity.createMany({ data: ugInstitutionsUniversities });
  await prisma.ugEntranceExam.createMany({ data: ugEntranceExams });
  await prisma.ugCourse.createMany({ data: ugCourses });
  await prisma.pgInstitution.createMany({ data: pgInstitutions });
  await prisma.pgEntranceExam.createMany({ data: pgEntranceExams });

  console.log(
    `Seeded career taxonomy: ${clusterNames.length} clusters, ${industryPairs.length} industries, ` +
      `${domainTriples.length} domains`
  );
  console.log(
    `Seeded career library data: ${careerLibrary.length} careers, ` +
      `${ugInstitutions.length} UG institutions (by industry), ` +
      `${ugInstitutionsUniversities.length} UG institutions/universities (general), ` +
      `${ugEntranceExams.length} UG entrance exams, ${ugCourses.length} UG courses, ` +
      `${pgInstitutions.length} PG institutions, ${pgEntranceExams.length} PG entrance exams`
  );
}
