// Guidance text for the counsellor chart's SCRI band, Academic x Career
// AlignmentRating, and Reliability indicators — sourced from the "Traits & Weightages"
// workbook's SCRI sheet (see prisma/schema.prisma ScriBandGuidance /
// AlignmentRatingGuidance / ReliabilityMeasureDefinition, seeded by
// prisma/seed-scoring.ts). Small (4 rows each), read-through Prisma rather than routed
// through the assessment scoring engine's in-memory cache.

import { prisma } from "../../config/prisma.js";

export interface ScriGuidance {
  scoreRange: string;
  labelMeaning: string;
  forStudents: string;
  tipsForStudents: string;
  tipsForParent: string;
}

export interface AlignmentGuidance {
  label: string;
  studentNote: string;
}

export interface ReliabilityMeasureGuidance {
  // "RVS" | "ARI" | "ACI" | "ORI" — the scoring engine's internal code, not the
  // counsellor-chart display code (EIM/ACI/AAI/HRS); the frontend maps between the two
  // (RVS→EIM, ARI→ACI, ACI→AAI, ORI→HRS).
  code: string;
  measure: string;
  friendlyName: string;
  whatItMeasures: string;
}

export async function loadScriGuidance(band: number | null): Promise<ScriGuidance | null> {
  if (band == null) return null;
  const row = await prisma.scriBandGuidance.findUnique({ where: { band } });
  if (!row) return null;
  return {
    scoreRange: row.scoreRange,
    labelMeaning: row.labelMeaning,
    forStudents: row.forStudents,
    tipsForStudents: row.tipsForStudents,
    tipsForParent: row.tipsForParent,
  };
}

export async function loadAlignmentGuidance(rating: string | null): Promise<AlignmentGuidance | null> {
  if (!rating) return null;
  const row = await prisma.alignmentRatingGuidance.findUnique({ where: { rating: rating as never } });
  if (!row) return null;
  return { label: row.label, studentNote: row.studentNote };
}

export async function loadReliabilityMeasureDefinitions(): Promise<ReliabilityMeasureGuidance[]> {
  const rows = await prisma.reliabilityMeasureDefinition.findMany();
  return rows.map(row => ({
    code: row.code,
    measure: row.measure,
    friendlyName: row.friendlyName,
    whatItMeasures: row.whatItMeasures,
  }));
}
