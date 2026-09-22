// One-time data fix for sessions that were genuinely attended (both studentJoinedAt and
// counsellorJoinedAt set) before joinSession started auto-completing on the second join —
// those rows are stuck at status SCHEDULED with the student's workflowStatus never having
// advanced to SESSION_1_COMPLETED/SESSION_2_COMPLETED. Applies the exact same completion
// (sessionsService.completeSession — status -> COMPLETED, advanceWorkflowStatus, and the
// Session-2 FEEDBACK_REQUEST_PARENT email) that would have run automatically had the fix
// been live when the session was attended.
//
// Run:  pnpm db:backfill:session-completion            (apply)
//       pnpm db:backfill:session-completion --dry-run  (report only, writes nothing)
//
// Idempotent: completeSession is a no-op on an already-COMPLETED session, and this script
// only selects status: SCHEDULED rows in the first place, so re-running finds nothing left
// to do once it has succeeded.

import { prisma } from "../src/config/prisma.js";
import * as sessionsService from "../src/modules/sessions/sessions.service.js";

export async function backfillSessionCompletion({ dryRun = false }: { dryRun?: boolean } = {}) {
  const stuck = await prisma.session.findMany({
    where: { status: "SCHEDULED", studentJoinedAt: { not: null }, counsellorJoinedAt: { not: null } },
    select: { id: true, sessionNumber: true, studentId: true, scheduledDate: true },
    // SESSION_1 before SESSION_2 per student — completeSession's Session-1-attended gate
    // for SESSION_2 only checks studentJoinedAt (already true for every row here), so this
    // ordering isn't load-bearing, just the more intuitive order to log.
    orderBy: [{ studentId: "asc" }, { sessionNumber: "asc" }],
  });

  if (stuck.length === 0) {
    console.log("No stuck sessions found (status SCHEDULED with both parties joined) — nothing to do.");
    return { found: 0, completed: 0, failed: 0 };
  }

  console.log(`Found ${stuck.length} session(s) both-joined but never completed:`);
  for (const s of stuck) {
    console.log(`  ${s.id}  ${s.sessionNumber}  student=${s.studentId}  scheduledDate=${s.scheduledDate.toISOString().slice(0, 10)}`);
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
