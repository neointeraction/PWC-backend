import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import type { AssessmentReport } from "../assessment/scoring/index.js";
import type { CareerFitResult, DomainFit } from "../assessment/scoring/careerFit.js";
import { aiResilienceRank } from "../assessment/scoring/careerFit.js";
import type { StreamFit, StreamFitResult } from "../assessment/scoring/streamFit.js";
import type { GraduationFit, GraduationFitResult } from "../assessment/scoring/graduationFit.js";
import type {
  CareerCompassItem as PersistedCareerCompassItem,
  StreamFitItem as PersistedStreamFitItem,
  GraduationItem as PersistedGraduationItem,
} from "../counsellor-chart/counsellor-chart.schema.js";
import { loadAlignmentGuidance, loadScriGuidance } from "../counsellor-chart/guidance.js";
import { getStudentFeedbackScore } from "../feedback/feedback.service.js";
import { fullName } from "../../common/utils/fullName.js";

// Same natural-key normalization as the frontend's `fitKey` (counsellorChart.service.ts)
// — lets a persisted row still match its assessment-scored domain across incidental
// casing/whitespace differences.
function domainKey(...parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");
}

// A counsellor-added job role reads exactly like a computed one on the report, plus a
// flag the frontend uses to badge/explain it — see mergeCounsellorJobRoles below.
type CareerCompassCard = DomainFit & { addedByCounsellor: boolean };

// Job roles a counsellor attached to this specific student's chart (Career Library entries
// scoped by `studentId`) always win a seat on the Career Compass, ahead of the assessment's
// computed fits — they're the counsellor's professional judgement about this individual
// student, not a generic algorithmic match. We keep the card count at 6: each counsellor
// role bumps the lowest-priority computed fit rather than stacking on top of it, and (to
// avoid two cards for the same industry) a computed fit is dropped if a counsellor role
// already covers that industry.
async function loadCounsellorJobRoleCards(studentId: string): Promise<CareerCompassCard[]> {
  const entries = await prisma.careerLibraryEntry.findMany({
    where: { studentId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: {
      jobRole: true,
      aiResilienceGrade: true,
      aiResilienceComment: true,
      oneLineDescription: true,
      topCompanies: true,
      salaryIndiaRangeText: true,
      salaryGlobalRangeText: true,
      domain: {
        select: { name: true, industry: { select: { name: true, cluster: { select: { name: true } } } } },
      },
    },
  });

  return entries.map((entry) => {
    const cluster = entry.domain.industry.cluster.name;
    const industry = entry.domain.industry.name;
    const domain = entry.domain.name;
    return {
      cluster,
      industry,
      domain,
      fitScore: null as unknown as number, // not algorithmically scored — counsellor-selected
      level: "Counsellor Recommended",
      meaning: "Added to this student's Counsellor Chart by their counsellor.",
      bestAiResilienceRank: aiResilienceRank(entry.aiResilienceGrade),
      addedByCounsellor: true,
      representativeCareer: {
        jobRole: entry.jobRole,
        cluster,
        industry,
        domain,
        aiResilienceGrade: entry.aiResilienceGrade,
        aiResilienceComment: entry.aiResilienceComment,
        oneLineDescription: entry.oneLineDescription,
        topCompanies: entry.topCompanies,
        salaryIndiaRangeText: entry.salaryIndiaRangeText,
        salaryGlobalRangeText: entry.salaryGlobalRangeText,
      },
    };
  });
}

// Merges counsellor-added job roles into the computed Career Fit's top-6, giving them
// priority: they lead the list, and computed fits fill the remaining seats (best fit
// first), capped at 6 total.
function mergeCounsellorJobRoles(
  careerFit: CareerFitResult | null,
  counsellorCards: CareerCompassCard[]
): (CareerFitResult & { top6Domains: CareerCompassCard[] }) | null {
  const counsellorIndustries = new Set(counsellorCards.map((c) => c.industry));
  const computed: CareerCompassCard[] = (careerFit?.top6Domains ?? [])
    .filter((d) => !counsellorIndustries.has(d.industry))
    .map((d) => ({ ...d, addedByCounsellor: false }));

  if (counsellorCards.length === 0) {
    return careerFit ? { ...careerFit, top6Domains: computed } : null;
  }

  const remainingSeats = Math.max(0, 6 - counsellorCards.length);
  const top6Domains: CareerCompassCard[] = [...counsellorCards, ...computed.slice(0, remainingSeats)].slice(0, 6);

  return {
    rankedDomains: careerFit?.rankedDomains ?? [],
    top6Domains,
    top3Industries: careerFit?.top3Industries ?? [],
  };
}

// Once a counsellor has saved any edit to the Career Compass (Target Roles & Compensation)
// table on the counsellor chart (Step3SectionC on the frontend), `CounsellorChart
// .careerCompassTable` holds the exact row set they see and edited there — including rows
// they deleted from the algorithmic default, and any they added via a career-library pick
// or manual entry. The report must show exactly this set, not a second, independently
// recomputed one, so this builds the report's cards directly from those persisted rows
// instead of re-deriving from `careerFit.top6Domains` (see mergeCounsellorJobRoles above,
// which is now only the pre-first-save fallback).
async function buildCareerCompassFromPersistedTable(
  careerFit: CareerFitResult | null,
  persistedTable: PersistedCareerCompassItem[]
): Promise<CareerFitResult & { top6Domains: CareerCompassCard[] }> {
  const roleIds = [...new Set(persistedTable.map((r) => r.roleId).filter((id): id is string => !!id))];
  const libraryEntries = roleIds.length
    ? await prisma.careerLibraryEntry.findMany({ where: { id: { in: roleIds } } })
    : [];
  const libraryById = new Map(libraryEntries.map((e) => [e.id, e]));

  // Keyed on (industry, domain) — a domain name is NOT globally unique in the career
  // library (58 of 571 live domain names repeat across unrelated industries, e.g. "Data
  // Science" under both Information Technology & Digital and Finance — confirmed
  // legitimate via audit, not data-entry duplicates), so a domain-only key can silently
  // collide two different industries' scores together. A domain-only fallback map is
  // kept alongside for rows persisted before the Career Compass redesign (or added
  // without a career-library pick), which can have blank `industry`/`cluster` — same
  // gap the counsellor chart's own hydration handles — and is only consulted when the
  // compound key misses.
  const scoredDomainByCompoundKey = new Map(
    (careerFit?.rankedDomains ?? []).map((d) => [domainKey(d.industry, d.domain), d])
  );
  const scoredDomainByNameOnly = new Map((careerFit?.rankedDomains ?? []).map((d) => [domainKey(d.domain), d]));
  const originalCareerByCompoundKey = new Map(
    (careerFit?.top6Domains ?? []).map((d) => [domainKey(d.industry, d.domain), d.representativeCareer])
  );
  const originalCareerByNameOnly = new Map(
    (careerFit?.top6Domains ?? []).map((d) => [domainKey(d.domain), d.representativeCareer])
  );

  const top6Domains: CareerCompassCard[] = persistedTable.map((row) => {
    const scored =
      scoredDomainByCompoundKey.get(domainKey(row.industry, row.domain)) ??
      (row.industry ? undefined : scoredDomainByNameOnly.get(domainKey(row.domain)));
    const libraryEntry = row.roleId ? libraryById.get(row.roleId) : undefined;
    const originalCareer =
      originalCareerByCompoundKey.get(domainKey(row.industry, row.domain)) ??
      (row.industry ? undefined : originalCareerByNameOnly.get(domainKey(row.domain)));
    const aiResilienceGrade = libraryEntry?.aiResilienceGrade ?? originalCareer?.aiResilienceGrade ?? "MEDIUM";
    const aiResilienceComment = libraryEntry?.aiResilienceComment ?? originalCareer?.aiResilienceComment ?? "";
    const cluster = row.cluster || scored?.cluster || "";
    const industry = row.industry || scored?.industry || "";

    return {
      cluster,
      industry,
      domain: row.domain,
      fitScore: scored?.fitScore ?? (null as unknown as number), // not algorithmically scored, see loadCounsellorJobRoleCards
      level: scored?.level ?? "Not Scored",
      meaning: scored?.meaning ?? "This role wasn't matched against a scored assessment domain.",
      bestAiResilienceRank: aiResilienceRank(aiResilienceGrade),
      // Absent both a career-library pick and a manual-entry flag, this row is an
      // untouched algorithmic default the counsellor never edited — see the schema
      // comment on CareerCompassItem.roleId for why default rows never carry a roleId.
      addedByCounsellor: !!(row.isManualEntry || row.roleId),
      representativeCareer: {
        jobRole: row.role,
        cluster,
        industry,
        domain: row.domain,
        aiResilienceGrade,
        aiResilienceComment,
        oneLineDescription: row.whyItFits,
        topCompanies: row.topEmployers
          ? row.topEmployers.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        salaryIndiaRangeText: row.salaryIndia || null,
        salaryGlobalRangeText: row.salaryAbroad || null,
      },
    };
  });

  return {
    rankedDomains: careerFit?.rankedDomains ?? [],
    top6Domains,
    top3Industries: careerFit?.top3Industries ?? [],
  };
}

// Same "report must match the chart exactly, once the counsellor has saved an edit"
// fix as buildCareerCompassFromPersistedTable, for the Stream Fit table (Step3SectionC's
// "Assessment Result View — Stream Fit & Pathways"). `top3` is what the report renders;
// `ranked` is kept as the full algorithmic list (still useful as a fit-score lookup
// elsewhere) and is never counsellor-edited.
function buildStreamFitFromPersistedTable(
  streamFit: StreamFitResult,
  persistedTable: PersistedStreamFitItem[]
): StreamFitResult {
  const scoredByKey = new Map(streamFit.ranked.map((s) => [domainKey(s.mainStream, s.subStream), s]));

  const top3: StreamFit[] = persistedTable.map((row) => {
    const scored = scoredByKey.get(domainKey(row.mainStream, row.subStream));
    return {
      mainStream: row.mainStream,
      subStream: row.subStream,
      coreSubjects: row.coreSubjects || scored?.coreSubjects || null,
      electiveSubjects: row.electives || scored?.electiveSubjects || null,
      explanation: row.explanation || scored?.explanation || null,
      // null (not 0) when there's no scored match — a manually-added row has no fit
      // score at all, and 0 would incorrectly grade as "Explore Carefully" downstream.
      fitScore: scored?.fitScore ?? (null as unknown as number),
      level: scored?.level ?? row.gradingLevel ?? "Not Scored",
      meaning: scored?.meaning ?? row.meaning ?? "This sub-stream wasn't matched against a scored assessment option.",
      weights: scored?.weights ?? {},
    };
  });

  return { ranked: streamFit.ranked, top3 };
}

// Same fix for the Graduation Fit table (Step3SectionC's "Graduation Table").
function buildGraduationFitFromPersistedTable(
  graduationFit: GraduationFitResult,
  persistedTable: PersistedGraduationItem[]
): GraduationFitResult {
  const scoredByKey = new Map(
    graduationFit.ranked.map((g) => [domainKey(g.clusterHead, g.mainStream, g.subStream), g])
  );

  const top3: GraduationFit[] = persistedTable.map((row) => {
    const scored = scoredByKey.get(domainKey(row.cluster, row.mainStream, row.subStream));
    return {
      clusterHead: row.cluster || scored?.clusterHead || null,
      mainStream: row.mainStream,
      subStream: row.subStream,
      specialisations: row.specialization || scored?.specialisations || null,
      eligibility: scored?.eligibility ?? null,
      keyExams: row.keyExams || scored?.keyExams || null,
      explanation: row.reasoning || scored?.explanation || null,
      // null (not 0) when there's no scored match — see the same comment in
      // buildStreamFitFromPersistedTable above.
      fitScore: scored?.fitScore ?? (null as unknown as number),
      level: scored?.level ?? "Not Scored",
      meaning: scored?.meaning ?? "This pathway wasn't matched against a scored assessment option.",
    };
  });

  return { ranked: graduationFit.ranked, top3 };
}

// Assembles the full student assessment report as one structured payload — the frontend
// renders the print/PDF view from this. Pulls together: the computed AssessmentReport
// (from the latest submitted attempt), the counsellor-authored narrative (CounsellorChart
// + notes), and the feedback score. All the numbers already exist; this just composes
// them into the report's sections.
export async function assembleStudentAssessmentReport(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      project: { select: { id: true, name: true, address: true } },
    },
  });
  if (!student) {
    throw new NotFoundError("Student not found");
  }

  // Latest computed result for the student (via their submitted attempt).
  const result = await prisma.assessmentResult.findFirst({
    where: { attempt: { studentId } },
    orderBy: { createdAt: "desc" },
    include: { attempt: { select: { cohort: true, submittedAt: true } } },
  });
  if (!result) {
    throw new NotFoundError(
      "No assessment result available — the student hasn't completed the assessment yet"
    );
  }
  const report = result.report as unknown as AssessmentReport;

  const chart = await prisma.counsellorChart.findUnique({
    where: { studentId },
    include: {
      notes: { select: { code: true, body: true, updatedAt: true }, orderBy: { code: "asc" } },
    },
  });

  // Feedback is a bonus section — never let it break report assembly.
  const feedback = await getStudentFeedbackScore(studentId).catch(() => null);

  // Once the counsellor has saved any edit to the chart's Career Compass table, that
  // persisted row set is authoritative — the report must match what they see/edited on
  // the chart exactly (see buildCareerCompassFromPersistedTable). Before their first save
  // (chart.careerCompassTable is still null), fall back to the pure algorithmic top-6 plus
  // any job roles added via the separate Career Library "scoped to this student" flow.
  const persistedCompassTable = (chart?.careerCompassTable as PersistedCareerCompassItem[] | null) ?? null;
  const careerCompass = persistedCompassTable
    ? await buildCareerCompassFromPersistedTable(report.careerFit, persistedCompassTable)
    : mergeCounsellorJobRoles(report.careerFit, await loadCounsellorJobRoleCards(studentId));

  // Same "report matches the chart" guarantee for Stream Fit and Graduation Pathways —
  // once the counsellor has saved an edit to either table on the chart, the report shows
  // exactly those rows instead of an independently recomputed top-3.
  const persistedStreamFitTable = (chart?.streamFitTable as PersistedStreamFitItem[] | null) ?? null;
  const streamFit = persistedStreamFitTable
    ? buildStreamFitFromPersistedTable(report.streamFit, persistedStreamFitTable)
    : report.streamFit;

  const persistedGraduationTable = (chart?.graduationTable as PersistedGraduationItem[] | null) ?? null;
  const graduationPathways = persistedGraduationTable
    ? buildGraduationFitFromPersistedTable(report.graduationPathways, persistedGraduationTable)
    : report.graduationPathways;

  const counsellorNarrative = chart
    ? {
        strengths: chart.strengths,
        hobbies: chart.hobbies,
        careerShortlist: chart.careerShortlist,
        scri: {
          confidence: chart.scriConfidence,
          reasonedThinking: chart.scriReasonedThinking,
          reducedAnxiety: chart.scriReducedAnxiety,
          selfAwareness: chart.scriSelfAwareness,
          careerCuriosity: chart.scriCareerCuriosity,
          decisionOwnership: chart.scriDecisionOwnership,
          total: chart.scriTotal,
          band: chart.scriBand,
          bandLabel: chart.scriBandLabel,
          guidance: await loadScriGuidance(chart.scriBand),
        },
        academicTrend: chart.academicTrend,
        alignmentRating: chart.alignmentRating,
        alignmentGuidance: await loadAlignmentGuidance(chart.alignmentRating),
        notes: chart.notes,
        finalizedAt: chart.finalizedAt,
      }
    : null;

  return {
    student: {
      id: student.id,
      name: fullName(student.user),
      email: student.user.email,
      studentCode: student.studentCode,
      academicYear: student.academicYear,
      workflowStatus: student.workflowStatus,
      institute: student.project?.name ?? null,
      class: student.className,
      division: student.divisionName,
      project: student.project?.name ?? null,
    },
    // Champion's Profile — the two dominant style codes/labels.
    championProfile: {
      dominantCareerStyle: report.dominantCareerStyle,
      dominantPersonalityStyle: report.dominantPersonalityStyle,
    },
    // Trait Map — the four scored layers plus the flat 18-trait map.
    traitMap: {
      traitScores: report.traitScores,
      riasec: report.riasec,
      bigFive: report.bigFive,
      aptitude: report.aptitude,
      cognitive: report.cognitive,
    },
    careerCompass, // top6Domains (+ representative careers) + top3Industries, or null — counsellor-added job roles take priority seats
    streamFit, // { top3, ranked }
    graduationPathways, // { top3, ranked }
    reliability: report.reliability, // { ari, aci, ori, rvs }
    counsellorNarrative,
    feedback,
    // Student/parent's acknowledgement of the finalized report. Backed by the same
    // CounsellorChart.acceptedAt stamp as POST /counsellor-chart/students/:id/accept —
    // "accepting the report" and "accepting the chart" are the same student action, so
    // this reuses that field rather than tracking a second acceptance record.
    accepted: Boolean(chart?.acceptedAt),
    acceptedAt: chart?.acceptedAt?.toISOString() ?? null,
    meta: {
      generatedAt: new Date().toISOString(),
      cohort: result.attempt.cohort,
      assessmentSubmittedAt: result.attempt.submittedAt,
      engineVersion: result.engineVersion,
      finalized: Boolean(chart?.finalizedAt),
      // Report sections still awaiting client sign-off in the engine (e.g. composite ARI).
      pending: report.meta?.pending ?? [],
    },
  };
}

// The student/parent accepts the finalized report — the counsellor's signal that the
// student has actually seen and confirmed it. Reuses CounsellorChart.acceptedAt (the same
// field POST /counsellor-chart/students/:id/accept stamps) rather than a separate
// acceptance record: from the student's side these are the same moment, and finalizedAt/
// acceptedAt are already forward-only, so a later chart edit doesn't invalidate an earlier
// acceptance (same idempotent pattern as the rest of the workflow). Idempotent — accepting
// twice returns the original timestamp.
//
// Doesn't email the parent — accepting and submitting the feedback forms are independent
// actions (a student can accept before, after, or without ever the parent's form being
// done), so it's not a reliable "both sides are done" signal. That email fires once the
// FEEDBACK_STUDENT/FEEDBACK_PARENT form pair completes instead — see saveFormAnswers in
// forms.service.ts.
export async function acceptStudentReport(studentId: string): Promise<{ acceptedAt: string }> {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!student) {
    throw new NotFoundError("Student not found");
  }

  const result = await prisma.assessmentResult.findFirst({
    where: { attempt: { studentId } },
    select: { id: true },
  });
  if (!result) {
    throw new NotFoundError(
      "No assessment result available — the student hasn't completed the assessment yet"
    );
  }

  const chart = await prisma.counsellorChart.findUnique({
    where: { studentId },
    select: { finalizedAt: true, acceptedAt: true },
  });
  if (!chart?.finalizedAt) {
    throw new BadRequestError("Cannot accept a report the counsellor hasn't finalized yet");
  }

  if (chart.acceptedAt) {
    return { acceptedAt: chart.acceptedAt.toISOString() };
  }

  const updated = await prisma.counsellorChart.update({
    where: { studentId },
    data: { acceptedAt: new Date() },
    select: { acceptedAt: true },
  });
  return { acceptedAt: updated.acceptedAt!.toISOString() };
}

// The student receiving their own report is the last step of the case, so it closes it.
// Two deliberate guards:
//   • only the student's own fetch counts — a counsellor or admin opening the report is
//     reviewing it, not receiving it;
//   • only from STUDENT_PARENT_FEEDBACK. advanceWorkflowStatus jumps straight to the
//     target, so without this an early fetch (the report is readable as soon as the
//     assessment is scored) would skip the whole tail of the lifecycle.
// Best-effort: the report is the deliverable, so a failure here is logged, not raised.
// Only closes the case — the parent notification lives on acceptStudentReport above now
// (an explicit action, not an implicit side effect of a GET), so it isn't duplicated here.
export async function markReportDeliveredToStudent(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { workflowStatus: true },
    });
    if (student?.workflowStatus !== "STUDENT_PARENT_FEEDBACK") return;
    await advanceWorkflowStatus(prisma, studentId, "CLOSED");
  } catch (err) {
    console.error(`Closing case on report delivery failed for student ${studentId}:`, err);
  }
}
