// Computes the chart's "Entrance Exams" and "Colleges After Class 11&12" tables from the
// assessment — the same treatment as Graduation Fit: derived server-side, counsellor
// read-only, never stored per-student. Anchored on `report.careerFit.top3Industries`
// (not `graduationPathways`, whose clusterHead/mainStream/subStream strings are a
// separate static taxonomy with no live link into the Career Library — see the
// investigation behind this file) because that's the one part of the report already tied
// to real `CareerCluster`/`CareerIndustry`/`CareerDomain` rows, which is what
// `EntranceExam`/`Institution` are actually linked to.

import { prisma } from "../../config/prisma.js";
import type { CollegesAfterItem, EntranceExamItem } from "./counsellor-chart.schema.js";

interface TopIndustry {
  cluster: string;
  industry: string;
}

// Matches AssessmentReport["careerFit"] (src/modules/assessment/scoring/careerFit.ts) —
// duplicated narrowly here rather than imported, since only these two fields are used.
interface CareerFitShape {
  top3Industries?: { cluster: string; industry: string }[] | null;
}

function dedupeIndustries(items: TopIndustry[]): TopIndustry[] {
  const seen = new Set<string>();
  const out: TopIndustry[] = [];
  for (const item of items) {
    const key = `${item.cluster}||${item.industry}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function computeEntranceExamsAndColleges(
  careerFit: CareerFitShape | null | undefined
): Promise<{ entranceExamsTable: EntranceExamItem[]; collegesTable: CollegesAfterItem[] }> {
  const topIndustries = dedupeIndustries(careerFit?.top3Industries ?? []);
  if (topIndustries.length === 0) {
    return { entranceExamsTable: [], collegesTable: [] };
  }

  // Resolve each (cluster, industry) name pair from the stored report snapshot against
  // the live taxonomy — cheap, and names rarely change.
  const industryRows = await prisma.careerIndustry.findMany({
    where: {
      deletedAt: null,
      OR: topIndustries.map((t) => ({ name: t.industry, cluster: { name: t.cluster, deletedAt: null } })),
    },
    select: {
      id: true,
      name: true,
      clusterId: true,
      cluster: { select: { name: true } },
      institutionLinks: {
        where: { institution: { status: "ACTIVE" } },
        select: { institution: true },
        orderBy: { institution: { name: "asc" } },
      },
      domains: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
  });
  if (industryRows.length === 0) {
    return { entranceExamsTable: [], collegesTable: [] };
  }

  const industryIds = industryRows.map((r) => r.id);
  const clusterIds = [...new Set(industryRows.map((r) => r.clusterId))];
  const domainIds = industryRows.flatMap((r) => r.domains.map((d) => d.id));

  // Priority = position in the (fitScore-sorted) top3Industries list — used only to break
  // ties when picking the top 6 of each table, so results favor better-fit industries.
  const industryPriority = new Map(topIndustries.map((t, i) => [`${t.cluster}||${t.industry}`, i]));
  const priorityByIndustryId = new Map(
    industryRows.map((r) => [r.id, industryPriority.get(`${r.cluster.name}||${r.name}`) ?? topIndustries.length])
  );
  const priorityByDomainId = new Map(
    industryRows.flatMap((r) => r.domains.map((d) => [d.id, priorityByIndustryId.get(r.id) ?? topIndustries.length]))
  );

  const [entryLinks, courseLinks] = await Promise.all([
    domainIds.length > 0
      ? prisma.careerLibraryEntry.findMany({
          where: { domainId: { in: domainIds }, status: "ACTIVE" },
          select: {
            domainId: true,
            entranceExamLinks: {
              where: { entranceExam: { status: "ACTIVE" } },
              select: { entranceExam: true },
            },
          },
        })
      : Promise.resolve([]),
    prisma.careerCourse.findMany({
      where: { clusterId: { in: clusterIds }, course: { status: "ACTIVE" } },
      select: { clusterId: true, course: { select: { name: true } } },
    }),
  ]);

  const coursesByCluster = new Map<string, string[]>();
  for (const link of courseLinks) {
    const list = coursesByCluster.get(link.clusterId) ?? [];
    list.push(link.course.name);
    coursesByCluster.set(link.clusterId, list);
  }

  const examsById = new Map<string, (typeof entryLinks)[number]["entranceExamLinks"][number]["entranceExam"]>();
  const examPriority = new Map<string, number>();
  for (const entry of entryLinks) {
    const priority = priorityByDomainId.get(entry.domainId) ?? topIndustries.length;
    for (const link of entry.entranceExamLinks) {
      examsById.set(link.entranceExam.id, link.entranceExam);
      const existing = examPriority.get(link.entranceExam.id);
      if (existing === undefined || priority < existing) examPriority.set(link.entranceExam.id, priority);
    }
  }

  // Top 6 exams, favoring those tied to better-fit industries (same treatment as
  // careerFit's top6Domains), alphabetical among ties.
  const entranceExamsTable: EntranceExamItem[] = [...examsById.values()]
    .sort(
      (a, b) =>
        (examPriority.get(a.id) ?? topIndustries.length) - (examPriority.get(b.id) ?? topIndustries.length) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 6)
    .map((exam) => ({
      id: exam.id,
      fullName: exam.fullForm || exam.name,
      conductingBody: exam.conductingBody ?? "",
      level: exam.level,
      applicableFor: exam.applicableFor ?? "",
      subjectRequirements: exam.subjectRequirements12th ?? "",
      examMonth: exam.applicationWindow ?? exam.frequency ?? "",
      urlLink: exam.officialWebsite ?? "",
    }));

  // Iterate industries best-fit-first so a college shared across industries is recorded
  // under its highest-priority one (only affects which `course` string it displays).
  const orderedIndustryRows = [...industryRows].sort(
    (a, b) => (priorityByIndustryId.get(a.id) ?? topIndustries.length) - (priorityByIndustryId.get(b.id) ?? topIndustries.length)
  );

  const collegesById = new Map<string, CollegesAfterItem>();
  const collegePriority = new Map<string, number>();
  for (const industryRow of orderedIndustryRows) {
    const priority = priorityByIndustryId.get(industryRow.id) ?? topIndustries.length;
    const courseNames = (coursesByCluster.get(industryRow.clusterId) ?? []).slice(0, 3).join(", ");
    for (const { institution } of industryRow.institutionLinks) {
      if (collegesById.has(institution.id)) continue;
      collegePriority.set(institution.id, priority);
      collegesById.set(institution.id, {
        id: institution.id,
        collegeName: institution.name,
        location: [institution.city, institution.state].filter(Boolean).join(", "),
        type: institution.type ?? "",
        course: courseNames,
        entranceExam: institution.entranceExamsRequired ?? "",
        ranking: institution.ranking ?? "",
        website: institution.website ?? "",
      });
    }
  }
  // Top 6 colleges, same priority-then-name treatment as the exams table.
  const collegesTable = [...collegesById.values()]
    .sort(
      (a, b) =>
        (collegePriority.get(a.id) ?? topIndustries.length) - (collegePriority.get(b.id) ?? topIndustries.length) ||
        a.collegeName.localeCompare(b.collegeName)
    )
    .slice(0, 6);

  return { entranceExamsTable, collegesTable };
}
