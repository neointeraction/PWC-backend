import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { computeEntranceExamsAndColleges } from "../src/modules/counsellor-chart/entrance-exams-colleges.js";

// Verifies the join from careerFit.top3Industries -> CareerIndustry -> its domains'
// CareerLibraryEntry (for exams) / its own institutionLinks (for colleges), including
// dedup across industries and the ACTIVE-only status gate.

describe("computeEntranceExamsAndColleges", () => {
  let clusterId: string;
  let industryAId: string;
  let industryBId: string;
  let domainAId: string;
  let domainBId: string;

  beforeAll(async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test EEC Cluster" } });
    clusterId = cluster.id;
    const industryA = await prisma.careerIndustry.create({
      data: { clusterId, name: "Test EEC Industry A" },
    });
    industryAId = industryA.id;
    const industryB = await prisma.careerIndustry.create({
      data: { clusterId, name: "Test EEC Industry B" },
    });
    industryBId = industryB.id;
    const domainA = await prisma.careerDomain.create({ data: { industryId: industryAId, name: "Test EEC Domain A" } });
    domainAId = domainA.id;
    const domainB = await prisma.careerDomain.create({ data: { industryId: industryBId, name: "Test EEC Domain B" } });
    domainBId = domainB.id;

    const activeExam = await prisma.entranceExam.create({
      data: { name: "Test EEC Active Exam", level: "UG", status: "ACTIVE", conductingBody: "Test Body" },
    });
    const pendingExam = await prisma.entranceExam.create({
      data: { name: "Test EEC Pending Exam", level: "UG", status: "DRAFT" },
    });
    const sharedExam = await prisma.entranceExam.create({
      data: { name: "Test EEC Shared Exam", level: "UG", status: "ACTIVE" },
    });

    const entryA = await prisma.careerLibraryEntry.create({
      data: {
        domainId: domainAId,
        jobRole: "Test EEC Role A",
        aiResilienceGrade: "HIGH",
        aiResilienceComment: "x",
        oneLineDescription: "x",
        qualification10th12th: "Any",
        status: "ACTIVE",
        createdBy: "test-seed",
      },
    });
    const entryB = await prisma.careerLibraryEntry.create({
      data: {
        domainId: domainBId,
        jobRole: "Test EEC Role B",
        aiResilienceGrade: "HIGH",
        aiResilienceComment: "x",
        oneLineDescription: "x",
        qualification10th12th: "Any",
        status: "ACTIVE",
        createdBy: "test-seed",
      },
    });
    await prisma.careerEntranceExam.createMany({
      data: [
        { careerEntryId: entryA.id, entranceExamId: activeExam.id },
        { careerEntryId: entryA.id, entranceExamId: pendingExam.id },
        { careerEntryId: entryA.id, entranceExamId: sharedExam.id },
        { careerEntryId: entryB.id, entranceExamId: sharedExam.id },
      ],
    });

    const activeInstitution = await prisma.institution.create({
      data: { name: "Test EEC Active College", status: "ACTIVE", city: "Test City" },
    });
    const pendingInstitution = await prisma.institution.create({
      data: { name: "Test EEC Pending College", status: "DRAFT" },
    });
    await prisma.careerInstitution.createMany({
      data: [
        { industryId: industryAId, institutionId: activeInstitution.id },
        { industryId: industryAId, institutionId: pendingInstitution.id },
      ],
    });

    const course = await prisma.course.create({ data: { name: "Test EEC Course", level: "UG", status: "ACTIVE" } });
    await prisma.careerCourse.create({ data: { clusterId, courseId: course.id } });
  });

  afterAll(async () => {
    await prisma.careerEntranceExam.deleteMany({ where: { entranceExam: { name: { startsWith: "Test EEC" } } } });
    await prisma.careerInstitution.deleteMany({ where: { institution: { name: { startsWith: "Test EEC" } } } });
    await prisma.careerCourse.deleteMany({ where: { clusterId } });
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: "Test EEC" } } });
    await prisma.entranceExam.deleteMany({ where: { name: { startsWith: "Test EEC" } } });
    await prisma.institution.deleteMany({ where: { name: { startsWith: "Test EEC" } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: "Test EEC" } } });
    await prisma.careerDomain.deleteMany({ where: { name: { startsWith: "Test EEC" } } });
    await prisma.careerIndustry.deleteMany({ where: { name: { startsWith: "Test EEC" } } });
    await prisma.careerCluster.deleteMany({ where: { name: { startsWith: "Test EEC" } } });
    await prisma.$disconnect();
  });

  it("returns empty tables when careerFit is null or has no qualifying industries", async () => {
    expect(await computeEntranceExamsAndColleges(null)).toEqual({ entranceExamsTable: [], collegesTable: [] });
    expect(await computeEntranceExamsAndColleges({ top3Industries: [] })).toEqual({
      entranceExamsTable: [],
      collegesTable: [],
    });
  });

  it("dedupes exams shared across industries, excludes non-ACTIVE rows, and scopes colleges to the industry", async () => {
    const result = await computeEntranceExamsAndColleges({
      top3Industries: [
        { cluster: "Test EEC Cluster", industry: "Test EEC Industry A" },
        { cluster: "Test EEC Cluster", industry: "Test EEC Industry B" },
      ],
    });

    const examNames = result.entranceExamsTable.map((e) => e.fullName).sort();
    expect(examNames).toEqual(["Test EEC Active Exam", "Test EEC Shared Exam"]);

    const active = result.entranceExamsTable.find((e) => e.fullName === "Test EEC Active Exam");
    expect(active?.conductingBody).toBe("Test Body");
    expect(active?.level).toBe("UG");

    const collegeNames = result.collegesTable.map((c) => c.collegeName);
    expect(collegeNames).toEqual(["Test EEC Active College"]);
    expect(result.collegesTable[0].location).toBe("Test City");
    expect(result.collegesTable[0].course).toBe("Test EEC Course");
  });
});
