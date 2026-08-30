import { prisma } from "../../config/prisma.js";
import { BadRequestError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { assembleChart } from "./counsellor-chart.assembler.js";
import { computeScri } from "./scri.js";
import type { PutCounsellorChartBody } from "./counsellor-chart.schema.js";

// Loads (lazily creating) the stored CounsellorChart row and its notes.
async function loadOrCreateChart(studentId: string) {
  return prisma.counsellorChart.upsert({
    where: { studentId },
    update: {},
    create: { studentId, strengths: [], hobbies: [], careerShortlist: [] },
    include: { notes: true },
  });
}

type ChartWithNotes = Awaited<ReturnType<typeof loadOrCreateChart>>;

function shapeCounsellorInputs(chart: ChartWithNotes) {
  const notes: Record<string, string> = {};
  for (const n of chart.notes) notes[n.code] = n.body;

  return {
    strengths: chart.strengths,
    hobbies: chart.hobbies,
    careerShortlist: chart.careerShortlist,
    academicTrend: chart.academicTrend,
    alignmentRating: chart.alignmentRating,
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
    notes,
    lastEditedBy: chart.lastEditedBy,
    finalizedAt: chart.finalizedAt,
    updatedAt: chart.updatedAt,
  };
}

export async function getCounsellorChart(studentId: string) {
  // assembleChart throws NotFoundError if the student doesn't exist.
  const assembled = await assembleChart(studentId);
  const chart = await loadOrCreateChart(studentId);
  return { ...assembled, counsellor: shapeCounsellorInputs(chart) };
}

export async function updateCounsellorChart(studentId: string, body: PutCounsellorChartBody) {
  const existing = await loadOrCreateChart(studentId);

  // Recompute the SCRI band from the merged (existing + incoming) indicator set.
  const merged = {
    confidence: body.scri?.confidence ?? existing.scriConfidence,
    reasonedThinking: body.scri?.reasonedThinking ?? existing.scriReasonedThinking,
    reducedAnxiety: body.scri?.reducedAnxiety ?? existing.scriReducedAnxiety,
    selfAwareness: body.scri?.selfAwareness ?? existing.scriSelfAwareness,
    careerCuriosity: body.scri?.careerCuriosity ?? existing.scriCareerCuriosity,
    decisionOwnership: body.scri?.decisionOwnership ?? existing.scriDecisionOwnership,
  };
  const scri = computeScri(merged);

  await prisma.counsellorChart.update({
    where: { studentId },
    data: {
      ...(body.strengths !== undefined && { strengths: body.strengths }),
      ...(body.hobbies !== undefined && { hobbies: body.hobbies }),
      ...(body.careerShortlist !== undefined && { careerShortlist: body.careerShortlist }),
      ...(body.academicTrend !== undefined && { academicTrend: body.academicTrend }),
      ...(body.alignmentRating !== undefined && { alignmentRating: body.alignmentRating }),
      ...(body.lastEditedBy !== undefined && { lastEditedBy: body.lastEditedBy }),
      scriConfidence: merged.confidence,
      scriReasonedThinking: merged.reasonedThinking,
      scriReducedAnxiety: merged.reducedAnxiety,
      scriSelfAwareness: merged.selfAwareness,
      scriCareerCuriosity: merged.careerCuriosity,
      scriDecisionOwnership: merged.decisionOwnership,
      scriTotal: scri.total,
      scriBand: scri.band,
      scriBandLabel: scri.label,
    },
  });

  // Upsert each provided synthesis note by (chartId, code).
  if (body.notes?.length) {
    await prisma.$transaction(
      body.notes.map((n) =>
        prisma.counsellorChartNote.upsert({
          where: { chartId_code: { chartId: existing.id, code: n.code } },
          update: { body: n.body },
          create: { chartId: existing.id, code: n.code, body: n.body },
        })
      )
    );
  }

  // The counsellor writing real chart content after Session 1 IS the "Counsellor
  // Feedback Report" stage — no separate button. Forward-only and idempotent, so
  // repeated saves (and saves made after Session 2) never move the status backwards.
  if (hasChartContent(body)) {
    await advanceWorkflowStatus(prisma, studentId, "COUNSELLOR_FEEDBACK_REPORT");
  }

  return getCounsellorChart(studentId);
}

// "Real" content, for the purpose of advancing the workflow and of allowing a finalize.
// `lastEditedBy` is deliberately excluded — it's an audit stamp, not counsellor work, so
// a save carrying only that doesn't count as starting the report.
function hasChartContent(chart: {
  strengths?: string[] | null;
  hobbies?: string[] | null;
  careerShortlist?: string[] | null;
  academicTrend?: string | null;
  alignmentRating?: string | null;
  scri?: Record<string, number | null | undefined> | null;
  notes?: unknown[] | null;
}): boolean {
  return Boolean(
    chart.strengths?.length ||
      chart.hobbies?.length ||
      chart.careerShortlist?.length ||
      chart.academicTrend ||
      chart.alignmentRating ||
      chart.notes?.length ||
      (chart.scri && Object.values(chart.scri).some((v) => v != null))
  );
}

// Finalize: the counsellor is done with the chart. Stamps `finalizedAt` (which the
// assessment report surfaces as `meta.finalized`) and advances the workflow to
// COUNSELLOR_FEEDBACK. Idempotent — re-finalizing keeps the original timestamp rather
// than erroring, so a double-click is harmless.
export async function finalizeCounsellorChart(studentId: string, finalizedBy?: string) {
  const chart = await loadOrCreateChart(studentId);

  if (!chart.finalizedAt) {
    const stored = {
      strengths: chart.strengths,
      hobbies: chart.hobbies,
      careerShortlist: chart.careerShortlist,
      academicTrend: chart.academicTrend,
      alignmentRating: chart.alignmentRating,
      notes: chart.notes,
      scri: {
        confidence: chart.scriConfidence,
        reasonedThinking: chart.scriReasonedThinking,
        reducedAnxiety: chart.scriReducedAnxiety,
        selfAwareness: chart.scriSelfAwareness,
        careerCuriosity: chart.scriCareerCuriosity,
        decisionOwnership: chart.scriDecisionOwnership,
      },
    };
    if (!hasChartContent(stored)) {
      throw new BadRequestError("Cannot finalize an empty chart — save the counsellor's content first");
    }

    await prisma.counsellorChart.update({
      where: { studentId },
      data: {
        finalizedAt: new Date(),
        ...(finalizedBy !== undefined && { lastEditedBy: finalizedBy }),
      },
    });
  }

  await advanceWorkflowStatus(prisma, studentId, "COUNSELLOR_FEEDBACK");

  return getCounsellorChart(studentId);
}
