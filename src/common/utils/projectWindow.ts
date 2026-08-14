import { prisma } from "../../config/prisma.js";
import { ForbiddenError, NotFoundError } from "../errors/AppError.js";

// Student- and parent-facing flows (form submissions, assessment attempts) have no login
// — a student/parent reaches them through a shared link, not an authenticated session.
// The student's Project window is therefore the only gate stopping a stale link from
// writing after the counselling cycle has ended. This helper enforces it: the project
// must still be ACTIVE and the end date (`toDate`) must not have passed.
//
// The end date is *inclusive of the whole day* — actions stay open through the last
// moment of the toDate calendar day (UTC), and only close once that day is over. So a
// project with toDate 2025-12-31 accepts writes all through Dec 31 and expires at the
// start of Jan 1. (Project dates are stored at UTC midnight, so the cutoff is the end of
// toDate's UTC day.)
//
// Call it at the top of every write action in those flows (before creating/mutating a
// submission or attempt); reads are intentionally left open so an ended project's data
// stays viewable. It also doubles as the student-exists check (throws 404 if unknown).
export async function assertStudentProjectWindowOpen(studentId: string): Promise<void> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      project: { select: { id: true, name: true, toDate: true, status: true } },
    },
  });
  if (!student) {
    throw new NotFoundError("Student not found");
  }

  const { project } = student;
  const now = new Date();
  const { toDate } = project;
  // Last millisecond of the toDate calendar day (UTC) — end date inclusive.
  const endOfDay = new Date(
    Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 23, 59, 59, 999)
  );
  const expired = now > endOfDay;

  if (project.status === "CLOSED" || project.status === "DELETED" || expired) {
    const reason =
      project.status === "DELETED"
        ? "PROJECT_DELETED"
        : project.status === "CLOSED"
          ? "PROJECT_CLOSED"
          : "PROJECT_EXPIRED";
    throw new ForbiddenError(
      reason === "PROJECT_DELETED"
        ? "This project is no longer available."
        : `This project has ended — submissions are closed (ended ${project.toDate
            .toISOString()
            .slice(0, 10)}).`,
      {
        reason,
        projectId: project.id,
        projectName: project.name,
        toDate: project.toDate,
        status: project.status,
      }
    );
  }
}
