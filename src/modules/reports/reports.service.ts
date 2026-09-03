import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import type { AssessmentReport } from "../assessment/scoring/index.js";
import { getStudentFeedbackScore } from "../feedback/feedback.service.js";

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
        },
        academicTrend: chart.academicTrend,
        alignmentRating: chart.alignmentRating,
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
    careerCompass: report.careerFit, // top6Domains (+ representative careers) + top3Industries, or null
    streamFit: report.streamFit, // { top3, ranked }
    graduationPathways: report.graduationPathways, // { top3, ranked }
    reliability: report.reliability, // { ari, aci, ori, rvs }
    counsellorNarrative,
    feedback,
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
      select: { workflowStatus: true },
    });
    if (student?.workflowStatus !== "STUDENT_PARENT_FEEDBACK") return;
    await advanceWorkflowStatus(prisma, studentId, "CLOSED");
  } catch (err) {
    console.error(`Closing case on report delivery failed for student ${studentId}:`, err);
  }
}
