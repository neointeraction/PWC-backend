import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { assembleChart } from "./counsellor-chart.assembler.js";
import { loadAlignmentGuidance, loadReliabilityMeasureDefinitions, loadScriGuidance } from "./guidance.js";
import { computeScri } from "./scri.js";
import type { PutCounsellorChartBody } from "./counsellor-chart.schema.js";
import { fullName } from "../../common/utils/fullName.js";

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
  const [scriGuidance, alignmentGuidance, reliabilityMeasures] = await Promise.all([
    loadScriGuidance(chart.scriBand),
    loadAlignmentGuidance(chart.alignmentRating),
    loadReliabilityMeasureDefinitions(),
  ]);
  const counsellor = shapeCounsellorInputs(chart);
  return {
    ...assembled,
    // Static code/name/guiding-question text for the Reliability of the Assessment
    // step's EIM/ACI/AAI/HRS cards — source: ReliabilityMeasureDefinition (SCRI sheet,
    // "Traits & Weightages" workbook, see ./guidance.ts). Always 4 rows, independent of
    // this student's chart state.
    reliabilityMeasures,
    counsellor: {
      ...counsellor,
      // Once the counsellor edits entranceExamsTable/collegesTable, the persisted array
      // wins over the live-computed default — same "last full array wins" model as the
      // other 4 tables above (see counsellor-chart.schema.ts). Nested under `counsellor`
      // (not top-level) to match CounsellorChartResponse and how the frontend reads it
      // (mapChartToFormData reads chart.counsellor.entranceExamsTable/collegesTable).
      entranceExamsTable: (chart.entranceExamsTable as unknown[] | null) ?? assembled.entranceExamsTable,
      collegesTable: (chart.collegesTable as unknown[] | null) ?? assembled.collegesTable,
      // Guidance text for the band/rating the counsellor has already recorded — null
      // until scri.band / alignmentRating are set. Source: SCRI sheet, "Traits &
      // Weightages" workbook (see ./guidance.ts).
      scri: { ...counsellor.scri, guidance: scriGuidance },
      alignmentGuidance,
    },
  };
}

// Stamps `addedAt` on any manual-entry row that doesn't already carry one — a row newly
// added this save — and leaves rows that already have an `addedAt` untouched, so it
// isn't overwritten on every subsequent save of the table (see counsellor-chart.schema.ts).
function stampManualEntryAddedAt<T extends { isManualEntry?: boolean; addedAt?: string }>(
  items: T[],
  now: string
): T[] {
  return items.map((item) =>
    item.isManualEntry === true && !item.addedAt ? { ...item, addedAt: now } : item
  );
}

export async function updateCounsellorChart(studentId: string, body: PutCounsellorChartBody) {
  const existing = await loadOrCreateChart(studentId);

  // Once the student has accepted the report, the chart — and therefore the report, which
  // is assembled live from it rather than a stored snapshot — is locked. This is the whole
  // point of acceptance: it's the student's sign-off on exactly what they saw, so nothing
  // may change under them afterward. No staff override; see docs/api-list.md.
  if (existing.acceptedAt) {
    throw new ConflictError(
      "This chart has been accepted by the student and can no longer be edited."
    );
  }

  const now = new Date().toISOString();

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
      ...(body.entranceExamsTable !== undefined && {
        entranceExamsTable: stampManualEntryAddedAt(body.entranceExamsTable, now),
      }),
      ...(body.collegesTable !== undefined && {
        collegesTable: stampManualEntryAddedAt(body.collegesTable, now),
      }),
      ...(body.streamFitTable !== undefined && {
        streamFitTable: stampManualEntryAddedAt(body.streamFitTable, now),
      }),
      ...(body.graduationTable !== undefined && {
        graduationTable: stampManualEntryAddedAt(body.graduationTable, now),
      }),
      ...(body.careerCompassClusterTable !== undefined && {
        careerCompassClusterTable: stampManualEntryAddedAt(body.careerCompassClusterTable, now),
      }),
      ...(body.careerCompassTable !== undefined && {
        careerCompassTable: stampManualEntryAddedAt(body.careerCompassTable, now),
      }),
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

  // Saving deliberately doesn't advance the workflow — counsellors fill the chart in
  // between Session 1 and Session 2, and the admin panel should keep showing
  // "Session 1 Completed" until then. The stage only moves on finalize (after Session 2).

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
    const studentName = fullName(chart.student.user);
    for (const { column, label } of MANUAL_ENTRY_TABLES) {
      const items = chart[column] as Record<string, unknown>[] | null;
      if (!items) continue;
      for (const item of items) {
        if (item.isManualEntry !== true) continue;
        const { id, isManualEntry: _isManualEntry, addedAt, ...rest } = item;
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(rest)) fields[key] = String(value);
        rows.push({
          id: String(id),
          studentId: chart.studentId,
          studentName,
          tableLabel: label,
          fields,
          addedBy: chart.lastEditedBy,
          // Falls back to the chart's last-save time only for rows written before this
          // per-row stamp existed (see counsellor-chart.schema.ts's `addedAt` field).
          addedAt: typeof addedAt === "string" ? addedAt : chart.updatedAt.toISOString(),
        });
      }
    }
  }
  return rows;
}

// Deletes a single manual-entry row (Super Admin "Close" action on the review queue).
// Scans the same 6 columns as listManualEntries for whichever student's chart holds a
// row with this id, then rewrites just that column with the row removed — the rest of
// the array, and every other column, is left untouched.
export async function deleteManualEntry(id: string): Promise<void> {
  const charts = await prisma.counsellorChart.findMany({
    where: {
      OR: MANUAL_ENTRY_TABLES.map(({ column }) => ({ [column]: { not: null } })),
    },
  });

  for (const chart of charts) {
    for (const { column } of MANUAL_ENTRY_TABLES) {
      const items = chart[column] as Record<string, unknown>[] | null;
      if (!items) continue;
      const index = items.findIndex((item) => item.isManualEntry === true && String(item.id) === id);
      if (index === -1) continue;

      const updated = [...items.slice(0, index), ...items.slice(index + 1)];
      await prisma.counsellorChart.update({
        where: { studentId: chart.studentId },
        data: { [column]: updated },
      });
      return;
    }
  }

  throw new NotFoundError("Manual entry not found");
}
