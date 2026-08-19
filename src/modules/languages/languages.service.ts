import { prisma } from "../../config/prisma.js";

// Read-only lookup for the project-creation language dropdown. Returns active languages in
// display order. No CRUD — languages are managed via seed for now (English is the default).
export async function listLanguages() {
  return prisma.language.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, isDefault: true, displayOrder: true },
  });
}
