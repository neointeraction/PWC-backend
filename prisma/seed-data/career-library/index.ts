import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const DIR = dirname(fileURLToPath(import.meta.url));

// Data source: "Career Library_Updated_0508.xlsx", exported to JSON by
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
  topCompanies: string[];
  salaryIndiaRangeText: string | null;
  salaryIndiaMinLPA: number | null;
  salaryIndiaMaxLPA: number | null;
  salaryGlobalRangeText: string | null;
  salaryGlobalMinUSD: number | null;
  salaryGlobalMaxUSD: number | null;
  qualification10th12th: string;
  qualificationGraduation: string | null;
  entranceExamsUGDescription: string | null;
  entranceExams: string[];
  qualificationPG: string | null;
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
  // CareerLibraryRequest.resultingEntryId references CareerLibraryEntry; clear it
  // first so the delete below doesn't hit the FK constraint.
  await prisma.careerLibraryRequest.deleteMany({ where: { resultingEntryId: { not: null } } });
  await prisma.careerLibraryEntry.deleteMany({});
  await prisma.ugInstitution.deleteMany({});
  await prisma.ugInstitutionUniversity.deleteMany({});
  await prisma.ugEntranceExam.deleteMany({});
  await prisma.ugCourse.deleteMany({});
  await prisma.pgInstitution.deleteMany({});
  await prisma.pgEntranceExam.deleteMany({});

  await prisma.careerLibraryEntry.createMany({
    data: careerLibrary.map((row) => ({
      ...row,
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
    `Seeded career library data: ${careerLibrary.length} careers, ` +
      `${ugInstitutions.length} UG institutions (by industry), ` +
      `${ugInstitutionsUniversities.length} UG institutions/universities (general), ` +
      `${ugEntranceExams.length} UG entrance exams, ${ugCourses.length} UG courses, ` +
      `${pgInstitutions.length} PG institutions, ${pgEntranceExams.length} PG entrance exams`
  );
}
