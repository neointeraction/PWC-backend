import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import type { AssessmentReport } from "../assessment/scoring/index.js";
import type { CareerFitResult, DomainFit } from "../assessment/scoring/careerFit.js";
import { aiResilienceRank } from "../assessment/scoring/careerFit.js";
import { loadAlignmentGuidance, loadScriGuidance } from "../counsellor-chart/guidance.js";
import { getStudentFeedbackScore } from "../feedback/feedback.service.js";
import { sendTemplateEmail } from "../email/email.service.js";

// Fire-and-forget: same pattern as students.service.ts's sendEmailBestEffort — an email
// failure here must never surface as a failure of the report fetch itself.
function sendEmailBestEffort(to: string, templateKey: Parameters<typeof sendTemplateEmail>[1], data: unknown): void {
  sendTemplateEmail(to, templateKey, data).catch((err) => {
    console.error(`[reports] failed to send ${templateKey} to ${to}:`, err);
  });
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

  const counsellorJobRoleCards = await loadCounsellorJobRoleCards(studentId);
  const careerCompass = mergeCounsellorJobRoles(report.careerFit, counsellorJobRoleCards);

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
      name: `${student.user.firstName} ${student.user.lastName}`,
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
    streamFit: report.streamFit, // { top3, ranked }
    graduationPathways: report.graduationPathways, // { top3, ranked }
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
export async function markReportDeliveredToStudent(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        workflowStatus: true,
        parentEmail: true,
        fatherName: true,
        motherName: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (student?.workflowStatus !== "STUDENT_PARENT_FEEDBACK") return;
    await advanceWorkflowStatus(prisma, studentId, "CLOSED");

    if (student.parentEmail) {
      sendEmailBestEffort(student.parentEmail, "REPORT_READY_PARENT", {
        parentName: student.fatherName || student.motherName || "Parent",
        studentName: `${student.user.firstName} ${student.user.lastName}`,
      });
    }
  } catch (err) {
    console.error(`Closing case on report delivery failed for student ${studentId}:`, err);
  }
}
