import { prisma } from "../../config/prisma.js";
import { SCRI_BANDS } from "../counsellor-chart/scri.js";

// Static reference data (4 rows, one per SCRI band) — not scoped to a student, so this
// pairs each ScriBandGuidance row with its real numeric cutoff from SCRI_BANDS rather
// than parsing the row's display-only `scoreRange` string.
export async function listScriBandGuidance() {
  const rows = await prisma.scriBandGuidance.findMany({ orderBy: { band: "asc" } });
  return rows.map((row) => {
    const range = SCRI_BANDS.find((b) => b.band === row.band);
    return {
      band: row.band,
      score: { min: range?.min ?? null, max: range?.max ?? null },
      label: row.label,
      labelMeaning: row.labelMeaning,
      forStudents: row.forStudents,
      tipsForStudents: row.tipsForStudents,
      tipsForParent: row.tipsForParent,
    };
  });
}
