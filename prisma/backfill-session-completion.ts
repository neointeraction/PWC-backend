// One-time data fix for two ways a session's completion can get stuck without
// workflowStatus reflecting it:
//
//  1. Both studentJoinedAt/counsellorJoinedAt set but status still SCHEDULED — sessions
//     attended before joinSession started auto-completing on the second join.
//  2. status already COMPLETED but the student's workflowStatus never advanced to match
//     (SESSION_1_COMPLETED/SESSION_2_COMPLETED) — the old per-student
//     Promise.all(sessions.map(reconcileSessionOnRead)) reconciliation could run Session
//     1's and Session 2's completeSession calls concurrently in separate transactions;
//     advanceWorkflowStatus's forward-only prerequisite check could then read the
//     pre-Session-1-completed workflowStatus inside Session 2's transaction and silently
//     skip its advance (see reconcileSessionsOnRead in sessions.service.ts, now sequential
//     to prevent this going forward).
//
// Both cases are fixed by calling sessionsService.completeSession, which now self-heals
// case 2 (advances workflowStatus even when the session is already COMPLETED) instead of
// being a bare no-op.
//
// Run:  pnpm db:backfill:session-completion            (apply)
//       pnpm db:backfill:session-completion --dry-run  (report only, writes nothing)
//
// Idempotent: completeSession no-ops (via advanceWorkflowStatus's own idempotency) once a
// session's workflowStatus already matches, so re-running finds nothing left to fix.

import { WORKFLOW_STATUS_ORDER } from "../src/common/workflow/workflowStatus.js";
import { prisma } from "../src/config/prisma.js";
import * as sessionsService from "../src/modules/sessions/sessions.service.js";

export async function backfillSessionCompletion({ dryRun = false }: { dryRun?: boolean } = {}) {
  const candidates = await prisma.session.findMany({
    where: {
      OR: [
        { status: "SCHEDULED", studentJoinedAt: { not: null }, counsellorJoinedAt: { not: null } },
        { status: "COMPLETED" },
      ],
    },
    select: { id: true, sessionNumber: true, status: true, studentId: true, scheduledDate: true, student: { select: { workflowStatus: true } } },
    // SESSION_1 before SESSION_2 per student, same as the sequential fix in
    // reconcileSessionsOnRead — completing Session 1 first is what lets Session 2's
    // advanceWorkflowStatus prerequisite check pass.
    orderBy: [{ studentId: "asc" }, { sessionNumber: "asc" }],
  });

  const stuck = candidates.filter((s) => {
    if (s.status === "SCHEDULED") return true; // case 1 — every row here already qualifies
    const target = s.sessionNumber === "SESSION_1" ? "SESSION_1_COMPLETED" : "SESSION_2_COMPLETED";
    return WORKFLOW_STATUS_ORDER.indexOf(s.student.workflowStatus) < WORKFLOW_STATUS_ORDER.indexOf(target); // case 2
  });

  if (stuck.length === 0) {
    console.log("No stuck sessions found — nothing to do.");
    return { found: 0, completed: 0, failed: 0 };
  }

  console.log(`Found ${stuck.length} stuck session(s):`);
  for (const s of stuck) {
    console.log(
      `  ${s.id}  ${s.sessionNumber}  status=${s.status}  student=${s.studentId} (workflowStatus=${s.student.workflowStatus})  scheduledDate=${s.scheduledDate.toISOString().slice(0, 10)}`
    );
  }

  if (dryRun) {
    console.log("\n--dry-run: no writes made.");
    return { found: stuck.length, completed: 0, failed: 0 };
  }

  let completed = 0;
  let failed = 0;
  for (const s of stuck) {
    try {
      await sessionsService.completeSession(s.id);
      completed++;
    } catch (err) {
      failed++;
      console.error(`  failed to complete ${s.id} (${s.sessionNumber}, student=${s.studentId}):`, err);
    }
  }

  console.log(`\ncompleted ${completed}, failed ${failed}, out of ${stuck.length} found.`);
  return { found: stuck.length, completed, failed };
}

const invokedDirectly = process.argv[1]?.includes("backfill-session-completion");
if (invokedDirectly) {
  backfillSessionCompletion({ dryRun: process.argv.includes("--dry-run") })
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
