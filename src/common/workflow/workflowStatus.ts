import type { Prisma, PrismaClient, WorkflowStatus } from "@prisma/client";

export const WORKFLOW_STATUS_ORDER: WorkflowStatus[] = [
  "DRAFT",
  "PROFILE_COMPLETED",
  "PRE_COUNSELLING_FORMS_SUBMITTED",
  "ASSESSMENT_PENDING",
  "ASSESSMENT_COMPLETED",
  "SESSION_SCHEDULED",
  "SESSION_1_COMPLETED",
  "COUNSELLOR_FEEDBACK_REPORT",
  "SESSION_2_COMPLETED",
  "COUNSELLOR_FEEDBACK",
  "STUDENT_PARENT_FEEDBACK",
  "CLOSED",
];

type Db = PrismaClient | Prisma.TransactionClient;

// Forward-only, idempotent: no-ops if the student is already at or past `target`.
// Used for system-triggered advances (forms/assessment hooks) where silently doing
// nothing on a re-run is correct — user-facing actions (e.g. confirming a profile)
// should layer their own guard/error on top of this for a clearer API response.
export async function advanceWorkflowStatus(db: Db, studentId: string, target: WorkflowStatus): Promise<void> {
  const student = await db.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { workflowStatus: true },
  });

  if (WORKFLOW_STATUS_ORDER.indexOf(target) <= WORKFLOW_STATUS_ORDER.indexOf(student.workflowStatus)) {
    return;
  }

  await db.student.update({ where: { id: studentId }, data: { workflowStatus: target } });
}
