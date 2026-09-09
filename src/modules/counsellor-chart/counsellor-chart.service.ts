import { prisma } from "../../config/prisma.js";
import { BadRequestError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { assembleChart } from "./counsellor-chart.assembler.js";
import { loadAlignmentGuidance, loadScriGuidance } from "./guidance.js";
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
    roadmapGrid: chart.roadmapGrid,
    careerDnaNarrative: chart.careerDnaNarrative,
    whyThisStream: chart.whyThisStream,
    // Career Direction tables the counsellor has edited (add/delete a row). null until
    // the counsellor's first edit — the frontend recomputes these fresh from the
    // assessment report until then (see the schema doc comment on PutCounsellorChartBody).
    streamFitTable: chart.streamFitTable,
    graduationTable: chart.graduationTable,
    careerCompassClusterTable: chart.careerCompassClusterTable,
    careerCompassTable: chart.careerCompassTable,
    lastEditedBy: chart.lastEditedBy,
    finalizedAt: chart.finalizedAt,
    acceptedAt: chart.acceptedAt,
    updatedAt: chart.updatedAt,
  };
}

export async function getCounsellorChart(studentId: string) {
  // assembleChart throws NotFoundError if the student doesn't exist.
  const assembled = await assembleChart(studentId);
  const chart = await loadOrCreateChart(studentId);
  const [scriGuidance, alignmentGuidance] = await Promise.all([
    loadScriGuidance(chart.scriBand),
    loadAlignmentGuidance(chart.alignmentRating),
  ]);
  const counsellor = shapeCounsellorInputs(chart);
  return {
    ...assembled,
    // Once the counsellor edits entranceExamsTable/collegesTable, the persisted array
    // wins over the live-computed default — same "last full array wins" model as the
    // 4 tables under `counsellor` below (see counsellor-chart.schema.ts).
    entranceExamsTable: (chart.entranceExamsTable as unknown[] | null) ?? assembled.entranceExamsTable,
    collegesTable: (chart.collegesTable as unknown[] | null) ?? assembled.collegesTable,
    counsellor: {
      ...counsellor,
      // Guidance text for the band/rating the counsellor has already recorded — null
      // until scri.band / alignmentRating are set. Source: SCRI sheet, "Traits &
      // Weightages" workbook (see ./guidance.ts).
      scri: { ...counsellor.scri, guidance: scriGuidance },
      alignmentGuidance,
    },
  };
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
      ...(body.roadmapGrid !== undefined && { roadmapGrid: body.roadmapGrid }),
      ...(body.careerDnaNarrative !== undefined && { careerDnaNarrative: body.careerDnaNarrative }),
      ...(body.whyThisStream !== undefined && { whyThisStream: body.whyThisStream }),
      ...(body.entranceExamsTable !== undefined && { entranceExamsTable: body.entranceExamsTable }),
      ...(body.collegesTable !== undefined && { collegesTable: body.collegesTable }),
      ...(body.streamFitTable !== undefined && { streamFitTable: body.streamFitTable }),
      ...(body.graduationTable !== undefined && { graduationTable: body.graduationTable }),
      ...(body.careerCompassClusterTable !== undefined && {
        careerCompassClusterTable: body.careerCompassClusterTable,
      }),
      ...(body.careerCompassTable !== undefined && { careerCompassTable: body.careerCompassTable }),
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

// Accept: the student acknowledges the finalized chart. Stamps `acceptedAt`, which is what
// gates this chart's career-library job-role proposals into the Super Admin's pending queue
// (see listCareerEntryProposals). Idempotent — re-accepting keeps the original timestamp.
// Deliberately doesn't touch the workflow status; that's driven by the feedback forms, not
// chart acceptance.
export async function acceptCounsellorChart(studentId: string) {
  const chart = await loadOrCreateChart(studentId);

  if (!chart.finalizedAt) {
    throw new BadRequestError("Cannot accept a chart the counsellor hasn't finalized yet");
  }

  if (!chart.acceptedAt) {
    await prisma.counsellorChart.update({
      where: { studentId },
      data: { acceptedAt: new Date() },
    });
  }

  return getCounsellorChart(studentId);
}

export interface ManualEntryRow {
  id: string;
  studentId: string;
  studentName: string;
  tableLabel: string;
  fields: Record<string, string>;
  addedBy: string | null;
  addedAt: string;
}

// Table titles verbatim, per docs/compass-tables-manual-entry-backend-prompt.md.
const MANUAL_ENTRY_TABLES: { column: keyof ManualEntryTableColumns; label: string }[] = [
  { column: "careerCompassClusterTable", label: "Career Compass (Indicative Clusters)" },
  { column: "careerCompassTable", label: "Career Compass (Target Roles & Compensation)" },
  { column: "streamFitTable", label: "Assessment Result View — Stream Fit & Pathways" },
  { column: "graduationTable", label: "Graduation Fit" },
  { column: "collegesTable", label: "Colleges After Class 11&12" },
  { column: "entranceExamsTable", label: "Entrance Exams" },
];

type ManualEntryTableColumns = {
  careerCompassClusterTable: unknown;
  careerCompassTable: unknown;
  streamFitTable: unknown;
  graduationTable: unknown;
  collegesTable: unknown;
  entranceExamsTable: unknown;
};

// Scans every student's counsellor chart across all 6 Career Direction tables for rows
// with `isManualEntry: true`, for the Super Admin review queue.
export async function listManualEntries(): Promise<ManualEntryRow[]> {
  const charts = await prisma.counsellorChart.findMany({
    where: {
      OR: MANUAL_ENTRY_TABLES.map(({ column }) => ({ [column]: { not: null } })),
    },
    include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });

  const rows: ManualEntryRow[] = [];
  for (const chart of charts) {
    const studentName = `${chart.student.user.firstName} ${chart.student.user.lastName}`.trim();
    for (const { column, label } of MANUAL_ENTRY_TABLES) {
      const items = chart[column] as Record<string, unknown>[] | null;
      if (!items) continue;
      for (const item of items) {
        if (item.isManualEntry !== true) continue;
        const { id, isManualEntry: _isManualEntry, ...rest } = item;
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(rest)) fields[key] = String(value);
        rows.push({
          id: String(id),
          studentId: chart.studentId,
          studentName,
          tableLabel: label,
          fields,
          addedBy: chart.lastEditedBy,
          addedAt: chart.updatedAt.toISOString(),
        });
      }
    }
  }
  return rows;
}
