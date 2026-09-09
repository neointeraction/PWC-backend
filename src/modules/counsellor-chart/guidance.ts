// Guidance text for the counsellor chart's SCRI band and Academic x Career
// AlignmentRating — sourced from the "Traits & Weightages" workbook's SCRI sheet (see
// prisma/schema.prisma ScriBandGuidance / AlignmentRatingGuidance, seeded by
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
