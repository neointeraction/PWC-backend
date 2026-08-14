import { prisma } from "../../config/prisma.js";

// Read-only lookup for populating cohort dropdowns (e.g. project creation). Returns the
// active cohorts in display order. No CRUD — cohorts are managed via seed for now.
export async function listCohorts() {
  return prisma.cohort.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, displayOrder: true },
  });
}
