import type { WorkflowStatus } from "@prisma/client";
import { prisma } from "../../src/config/prisma.js";

// Fixtures create students through POST /students, which starts them at DRAFT. Stage guards
// (forms, assessment, sessions) now stop a student acting on a stage they haven't reached,
// so a test that exercises a later step first seeds the student at the stage it needs.
export async function setStage(studentId: string, workflowStatus: WorkflowStatus): Promise<void> {
  await prisma.student.update({ where: { id: studentId }, data: { workflowStatus } });
}
