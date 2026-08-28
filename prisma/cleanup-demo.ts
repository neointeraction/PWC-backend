// One-off cleanup for the demo data that `prisma/seed.ts` used to create before
// `seedDemoAccounts()` was removed. Existing databases still carry those rows, so run
// this once to clear them:
//
//   pnpm tsx prisma/cleanup-demo.ts          # dry run — reports what it would delete
//   pnpm tsx prisma/cleanup-demo.ts --yes    # actually delete
//
// Scoped strictly to the seeded demo identifiers below — it never touches anything an
// admin created through the API. Idempotent: re-running it after a successful pass is
// a no-op.
//
// Deletion order matters. `Counsellor.institute` and `Student.division` are *not*
// cascading relations, so removing the institute first would hit a FK constraint. We
// therefore go users → project → institute and let the cascades do the rest:
//   User    ->  Counsellor / Student                    (onDelete: Cascade)
//   Project ->  ProjectCounsellor / CounsellorSlot / Student
//   Institute -> InstituteClass -> InstituteDivision, Project
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_USER_EMAILS = [
  "admin@kreate.local",
  "counsellor@kreate.local",
  "student@kreate.local",
];
const DEMO_INSTITUTE_NAME = "Demo Institute";
const DEMO_PROJECT_NAME = "Demo Project";

const apply = process.argv.includes("--yes");

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_USER_EMAILS } },
    select: { id: true, email: true, role: true },
  });

  const institute = await prisma.institute.findUnique({
    where: { name: DEMO_INSTITUTE_NAME },
    select: { id: true, name: true },
  });

  const projects = institute
    ? await prisma.project.findMany({
        where: { instituteId: institute.id, name: DEMO_PROJECT_NAME },
        select: { id: true, name: true, code: true },
      })
    : [];

  // Everything that will disappear via cascade, counted up front so the dry run is honest
  // about the blast radius rather than only naming the three top-level records.
  const projectIds = projects.map(p => p.id);
  const [counsellorLinks, slots, students] = await Promise.all([
    projectIds.length
      ? prisma.projectCounsellor.count({ where: { projectId: { in: projectIds } } })
      : 0,
    projectIds.length
      ? prisma.counsellorSlot.count({ where: { projectId: { in: projectIds } } })
      : 0,
    projectIds.length ? prisma.student.count({ where: { projectId: { in: projectIds } } }) : 0,
  ]);

  console.log(apply ? "Deleting demo data:" : "Dry run — nothing will be deleted:");
  console.log(`  users            : ${users.length ? users.map(u => u.email).join(", ") : "none"}`);
  console.log(`  project          : ${projects.length ? projects.map(p => `${p.name} (${p.code})`).join(", ") : "none"}`);
  console.log(`  institute        : ${institute ? institute.name : "none"}`);
  console.log(`  cascades         : ${counsellorLinks} projectCounsellor, ${slots} counsellorSlot, ${students} student`);

  if (!users.length && !projects.length && !institute) {
    console.log("\nNothing to do — the demo data is already gone.");
    return;
  }

  if (!apply) {
    console.log("\nRe-run with --yes to apply.");
    return;
  }

  // 1. Users first — cascades their Counsellor / Student profiles, which in turn releases
  //    the non-cascading Counsellor.instituteId and Student.divisionId references.
  if (users.length) {
    const { count } = await prisma.user.deleteMany({
      where: { email: { in: DEMO_USER_EMAILS } },
    });
    console.log(`Deleted ${count} demo user(s)`);
  }

  // 2. The project — cascades any remaining ProjectCounsellor / CounsellorSlot / Student.
  if (projectIds.length) {
    const { count } = await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    console.log(`Deleted ${count} demo project(s)`);
  }

  // 3. The institute — cascades its classes and divisions.
  if (institute) {
    await prisma.institute.delete({ where: { id: institute.id } });
    console.log(`Deleted institute "${institute.name}"`);
  }

  console.log("\nDone.");
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
