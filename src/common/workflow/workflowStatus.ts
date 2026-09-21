import type { Prisma, PrismaClient, WorkflowStatus } from "@prisma/client";
import { ConflictError } from "../errors/AppError.js";

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

// The earliest stage a student must already be at for `target` to be a legitimate next
// step. advanceWorkflowStatus jumps straight to its target, so without this a call made too
// early (e.g. a feedback form submitted at DRAFT) would skip every stage in between.
// Mostly "the stage right before", with two deliberate exceptions:
//   • SESSION_2_COMPLETED only needs SESSION_1_COMPLETED — the counsellor's feedback
//     report (COUNSELLOR_FEEDBACK_REPORT) between the two sessions is optional to reach.
//   • STUDENT_PARENT_FEEDBACK only needs SESSION_2_COMPLETED — the student/parent feedback
//     forms run in parallel with COUNSELLOR_FEEDBACK, in either order.
const WORKFLOW_PREREQUISITE: Partial<Record<WorkflowStatus, WorkflowStatus>> = {
  PROFILE_COMPLETED: "DRAFT",
  PRE_COUNSELLING_FORMS_SUBMITTED: "PROFILE_COMPLETED",
  ASSESSMENT_PENDING: "PRE_COUNSELLING_FORMS_SUBMITTED",
  ASSESSMENT_COMPLETED: "ASSESSMENT_PENDING",
  SESSION_SCHEDULED: "ASSESSMENT_COMPLETED",
  SESSION_1_COMPLETED: "SESSION_SCHEDULED",
  COUNSELLOR_FEEDBACK_REPORT: "SESSION_1_COMPLETED",
  SESSION_2_COMPLETED: "SESSION_1_COMPLETED",
  COUNSELLOR_FEEDBACK: "SESSION_2_COMPLETED",
  STUDENT_PARENT_FEEDBACK: "SESSION_2_COMPLETED",
  CLOSED: "STUDENT_PARENT_FEEDBACK",
};

export function isWorkflowStageAtLeast(current: WorkflowStatus, minimum: WorkflowStatus): boolean {
  return WORKFLOW_STATUS_ORDER.indexOf(current) >= WORKFLOW_STATUS_ORDER.indexOf(minimum);
}

// Throws 409 unless the student has already reached `minimum` — the guard each action
// puts in front of itself so a student can't act on a stage they haven't got to yet.
export async function assertWorkflowStageAtLeast(
  db: Db,
  studentId: string,
  minimum: WorkflowStatus,
  message: string
): Promise<void> {
  const student = await db.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { workflowStatus: true },
  });
  if (!isWorkflowStageAtLeast(student.workflowStatus, minimum)) {
    throw new ConflictError(message);
  }
}

// Forward-only, idempotent: no-ops if the student is already at or past `target`, and also
// no-ops (rather than skipping stages) if they haven't yet reached `target`'s prerequisite
// stage. Used for system-triggered advances (forms/assessment hooks) where silently doing
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

  const prerequisite = WORKFLOW_PREREQUISITE[target];
  if (prerequisite && !isWorkflowStageAtLeast(student.workflowStatus, prerequisite)) {
    console.warn(
      `[workflow] not advancing student ${studentId} from ${student.workflowStatus} to ${target}: needs ${prerequisite} first`
    );
    return;
  }

  await db.student.update({ where: { id: studentId }, data: { workflowStatus: target } });
}
