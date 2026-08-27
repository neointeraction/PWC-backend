import { afterAll, beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { prisma } from "../src/config/prisma.js";
import { istDateUtcMidnight } from "../src/common/utils/istDate.js";
import { runSessionDayReminders, runFollowUpNudges } from "../src/scheduler/jobs.js";

// Everything is created in one dedicated project so the jobs can be scoped to it and never
// touch data from other test files (they scan globally in production).
let projectId: string;
let divisionId: string;
let counsellorId: string;
const DAY_MS = 24 * 60 * 60 * 1000;
const suffix = Date.now().toString().slice(-6);

async function makeStudent(opts: {
  key: string;
  workflowStatus?: "DRAFT" | "SESSION_SCHEDULED";
  createdAt?: Date;
}) {
  const user = await prisma.user.create({
    data: {
      email: `sched-${opts.key}-${suffix}@test-scheduler.example`,
      passwordHash: await argon2.hash("x"),
      role: "STUDENT",
      firstName: opts.key,
      lastName: "Test",
    },
  });
  return prisma.student.create({
    data: {
      userId: user.id,
      studentCode: `SCHED-${opts.key}-${suffix}`,
      projectId,
      divisionId,
      mobile: `+9199${suffix}${opts.key.charCodeAt(0)}`.slice(0, 13),
      parentMobile: `+9188${suffix}${opts.key.charCodeAt(0)}`.slice(0, 13),
      parentEmail: `sched-${opts.key}-parent-${suffix}@test-scheduler.example`,
      fatherName: "Father",
      workflowStatus: opts.workflowStatus ?? "DRAFT",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

describe("Scheduler jobs", () => {
  beforeAll(async () => {
    const institute = await prisma.institute.create({
      data: {
        name: `Sched Institute ${suffix}`,
        address: "1 St",
        contactNumber: `+9177${suffix}0`,
        primaryEmail: `sched-inst-${suffix}@test-scheduler.example`,
      },
    });
    const project = await prisma.project.create({
      data: {
        instituteId: institute.id,
        name: `Sched Project ${suffix}`,
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2030-12-31"),
      },
    });
    projectId = project.id;
    const klass = await prisma.instituteClass.create({ data: { name: "9", instituteId: institute.id } });
    const division = await prisma.instituteDivision.create({ data: { name: "A", classId: klass.id } });
    divisionId = division.id;

    const counsellorUser = await prisma.user.create({
      data: {
        email: `sched-cnsl-${suffix}@test-scheduler.example`,
        passwordHash: await argon2.hash("x"),
        role: "COUNSELLOR",
        firstName: "Cnsl",
        lastName: "Test",
      },
    });
    const counsellor = await prisma.counsellor.create({
      data: {
        userId: counsellorUser.id,
        counsellorCode: `SCHED-CN-${suffix}`,
        instituteId: institute.id,
        mobile: `+9166${suffix}0`,
      },
    });
    counsellorId = counsellor.id;
  });

  afterAll(async () => {
    // Session.counsellor is ON DELETE RESTRICT — clear sessions before deleting the users.
    await prisma.session.deleteMany({ where: { counsellorId } });
    await prisma.user.deleteMany({ where: { email: { contains: "@test-scheduler.example" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "Sched Project" } } });
    await prisma.institute.deleteMany({ where: { name: { startsWith: "Sched Institute" } } });
    await prisma.$disconnect();
  });

  it("sends same-day session reminders once and is idempotent on re-run", async () => {
    const now = new Date();
    const student = await makeStudent({ key: "S", workflowStatus: "SESSION_SCHEDULED" });

    const todaySession = await prisma.session.create({
      data: {
        studentId: student.id,
        counsellorId,
        sessionNumber: "SESSION_1",
        scheduledDate: istDateUtcMidnight(now),
        startTime: "11:00",
        endTime: "12:00",
        status: "SCHEDULED",
      },
    });
    // A session tomorrow must NOT be reminded today.
    const futureSession = await prisma.session.create({
      data: {
        studentId: student.id,
        counsellorId,
        sessionNumber: "SESSION_2",
        scheduledDate: istDateUtcMidnight(new Date(now.getTime() + DAY_MS)),
        startTime: "11:00",
        endTime: "12:00",
        status: "SCHEDULED",
      },
    });

    const first = await runSessionDayReminders(now, { projectId });
    expect(first.remindersSent).toBe(1);
    expect((await prisma.session.findUnique({ where: { id: todaySession.id } }))?.dayReminderSentAt).not.toBeNull();
    expect((await prisma.session.findUnique({ where: { id: futureSession.id } }))?.dayReminderSentAt).toBeNull();

    // Re-run: already-reminded session is skipped.
    const second = await runSessionDayReminders(now, { projectId });
    expect(second.remindersSent).toBe(0);
  });

  it("nudges an idle student once, respects the cooldown, and skips fresh students", async () => {
    const now = new Date();
    const idle = await makeStudent({ key: "I", createdAt: new Date(now.getTime() - 5 * DAY_MS) }); // DRAFT, 5 days idle
    const fresh = await makeStudent({ key: "F", createdAt: now }); // DRAFT today — not flagged

    const first = await runFollowUpNudges(now, { projectId });
    expect(first.nudgesSent).toBeGreaterThanOrEqual(1);
    expect((await prisma.student.findUnique({ where: { id: idle.id } }))?.lastNudgeAt).not.toBeNull();
    expect((await prisma.student.findUnique({ where: { id: fresh.id } }))?.lastNudgeAt).toBeNull();

    // Re-run same day: cooldown (2 days) suppresses a repeat nudge.
    const second = await runFollowUpNudges(now, { projectId });
    expect(second.nudgesSent).toBe(0);
  });
});
