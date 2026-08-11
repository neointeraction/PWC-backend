import { prisma } from "../../config/prisma.js";
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

  return getCounsellorChart(studentId);
}
