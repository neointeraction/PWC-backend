import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { setStage } from "./helpers/stage.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const COHORT = "CLASS_9_10";

let studentAId: string;
let studentAToken: string;
let studentBId: string;
let studentBToken: string;

interface Q { fieldKey: string; format: string; options: { value: string }[] | null }

async function makeStudent(suffix: string, mobile: string, parentMobile: string, projectId: string) {
  const res = await authRequest(app).post("/api/v1/students").send({
    firstName: "Rep",
    lastName: suffix,
    email: `rep-${suffix}@test-reports.example`,
    mobile,
    studentCode: `REP${suffix}`,
    projectId,
    className: "Grade 9",
    divisionName: "A",
    parentMobile,
    parentEmail: `parent-${suffix}@test-reports.example`,
    fatherName: "F",
    fatherOccupation: "Engineer",
    motherName: "M",
    motherOccupation: "Doctor",
  });
  await setStage(res.body.student.id, "PRE_COUNSELLING_FORMS_SUBMITTED");
  return res.body.student.id as string;
}

describe("Reports — student assessment report", () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        code: "P-REP",
        name: "Test Project Reports",
        address: "1 Rep St",
        contactNumber: "+919876575001",
        primaryEmail: "reports@test-project.example",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });

    studentAId = await makeStudent("A", "+919876575002", "+919876575003", project.id);
    studentBId = await makeStudent("B", "+919876575004", "+919876575005", project.id);

    const rowA = await prisma.student.findUnique({ where: { id: studentAId }, select: { userId: true } });
    studentAToken = bearer("STUDENT", { userId: rowA!.userId });
    const rowB = await prisma.student.findUnique({ where: { id: studentBId }, select: { userId: true } });
    studentBToken = bearer("STUDENT", { userId: rowB!.userId });

    // Run the full assessment for student A so a computed result exists.
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId: studentAId, cohort: COHORT });
    const questions = (await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT })).body as Q[];
    const answers = questions.map((q) => ({ fieldKey: q.fieldKey, selectedOption: q.format === "MCQ_SINGLE" ? q.options?.[0]?.value ?? "A" : "5" }));
    await authRequest(app).put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`).send({ answers });
    await authRequest(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@test-reports.example" } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Reports" } });
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: "Counsellor-Picked Role" } });
    const industry = await prisma.careerIndustry.findFirst({ where: { name: "Test Reports Industry" } });
    if (industry) {
      await prisma.careerDomain.deleteMany({ where: { industryId: industry.id } });
      await prisma.careerIndustry.deleteMany({ where: { id: industry.id } });
    }
    await prisma.careerCluster.deleteMany({ where: { name: "Test Reports Cluster" } });
    await prisma.$disconnect();
  });

  it("assembles the full report once the assessment is submitted", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.student.name).toBe("Rep A");
    expect(b.student.institute).toBe("Test Project Reports");
    expect(b.championProfile.dominantCareerStyle.code).toHaveLength(3);
    expect(b.championProfile.dominantPersonalityStyle.code).toContain("-");
    expect(b.traitMap.riasec.scores).toHaveLength(6);
    expect(Object.keys(b.traitMap.traitScores)).toHaveLength(18);
    expect(b.careerCompass).not.toBeNull();
    expect(Array.isArray(b.streamFit.top3)).toBe(true);
    expect(Array.isArray(b.graduationPathways.top3)).toBe(true);
    expect(b.reliability.rvs).toBeTruthy();
    expect(b.counsellorNarrative).toBeNull(); // no chart authored yet
    expect(b.feedback).toBeTruthy(); // { complete:false, ... } since forms aren't in
    expect(b.meta.cohort).toBe(COHORT);
    expect(b.meta.finalized).toBe(false);
  });

  it("gives a counsellor-added job role a priority seat in the career compass", async () => {
    const cluster = await prisma.careerCluster.create({ data: { name: "Test Reports Cluster" } });
    const industry = await prisma.careerIndustry.create({
      data: { clusterId: cluster.id, name: "Test Reports Industry" },
    });
    const domain = await prisma.careerDomain.create({
      data: { industryId: industry.id, name: "Test Reports Domain" },
    });
    await prisma.careerLibraryEntry.create({
      data: {
        domainId: domain.id,
        jobRole: "Counsellor-Picked Role",
        aiResilienceGrade: "HIGH",
        aiResilienceComment: "Resilient because reasons",
        oneLineDescription: "Does a counsellor-chosen thing",
        status: "ACTIVE",
        createdBy: "test-seed",
        studentId: studentAId,
      },
    });

    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(200);
    const top6 = res.body.careerCompass.top6Domains as { addedByCounsellor: boolean; representativeCareer: { jobRole: string } }[];
    expect(top6.length).toBeLessThanOrEqual(6);
    expect(top6[0].addedByCounsellor).toBe(true);
    expect(top6[0].representativeCareer.jobRole).toBe("Counsellor-Picked Role");
    expect(top6.filter((c) => c.addedByCounsellor).length).toBe(1);
  });

  // From here on, every test saves `careerCompassTable`, which becomes authoritative for
  // the report (see buildCareerCompassFromPersistedTable) — so this must run last among
  // the tests exercising the pre-first-save (`mergeCounsellorJobRoles`) fallback path.
  it("backfills cluster/industry and re-attaches fit score for a chart row saved without them", async () => {
    // A counsellor chart row from before the Career Compass redesign (or one added
    // without a career-library pick) can be persisted with blank cluster/industry — the
    // report must still resolve them from the domain name, exactly like the counsellor
    // chart's own hydration does (see buildCareerCompassFromPersistedTable in
    // reports.service.ts).
    const before = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    const originalTop6 = before.body.careerCompass.top6Domains as {
      cluster: string;
      industry: string;
      domain: string;
      fitScore: number;
      addedByCounsellor: boolean;
    }[];
    // Skip the "Counsellor-Picked Role" seat from the previous test — that domain lives
    // only in the career library, not the assessment's scored domain table, so it has
    // nothing to backfill from. Pick an algorithmically-scored one instead.
    const pick = originalTop6.find((c) => !c.addedByCounsellor)!;
    expect(pick).toBeTruthy();

    const putRes = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentAId}`)
      .send({
        careerCompassTable: [
          {
            id: "cc-test-blank",
            cluster: "",
            industry: "",
            domain: pick.domain,
            role: "Blank Cluster Role",
            whyItFits: "",
            topEmployers: "",
            salaryIndia: "",
            salaryAbroad: "",
          },
        ],
      });
    expect(putRes.status).toBe(200);

    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    const top6 = res.body.careerCompass.top6Domains as {
      cluster: string;
      industry: string;
      domain: string;
      fitScore: number;
    }[];
    expect(top6).toHaveLength(1);
    expect(top6[0].domain).toBe(pick.domain);
    // Backfilled from the assessment's scored domain by name — not asserting an exact
    // cluster/industry/fitScore match, since the career library has ~58 domain names that
    // aren't unique across industries (a pre-existing data-quality gap the frontend's own
    // name-only lookup has too, e.g. domainFitByKey/domainInfoByKey in
    // counsellorChart.service.ts); the fix under test here is "no longer blank/unscored".
    expect(top6[0].cluster).not.toBe("");
    expect(top6[0].industry).not.toBe("");
    expect(typeof top6[0].fitScore).toBe("number");
  });

  it("matches the counsellor chart's Stream Fit and Graduation tables exactly once saved", async () => {
    const before = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    const originalStream = before.body.streamFit.top3[0] as { mainStream: string; subStream: string; fitScore: number };
    const originalGrad = before.body.graduationPathways.top3[0] as {
      clusterHead: string | null;
      mainStream: string;
      subStream: string;
      fitScore: number;
    };

    const putRes = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentAId}`)
      .send({
        streamFitTable: [
          {
            id: "sf-test-1",
            mainStream: originalStream.mainStream,
            subStream: originalStream.subStream,
            coreSubjects: "Counsellor-Edited Core Subjects",
            electives: "Counsellor-Edited Electives",
          },
        ],
        graduationTable: [
          {
            id: "gp-test-1",
            cluster: originalGrad.clusterHead ?? originalGrad.mainStream,
            mainStream: originalGrad.mainStream,
            subStream: originalGrad.subStream,
            specialization: "Counsellor-Edited Specialization",
            reasoning: "Counsellor-edited reasoning text",
            keyExams: "Counsellor-Edited Exams",
          },
        ],
      });
    expect(putRes.status).toBe(200);

    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(200);

    const streamTop3 = res.body.streamFit.top3 as { mainStream: string; coreSubjects: string; fitScore: number }[];
    expect(streamTop3).toHaveLength(1);
    expect(streamTop3[0].coreSubjects).toBe("Counsellor-Edited Core Subjects");
    expect(streamTop3[0].fitScore).toBe(originalStream.fitScore);

    const gradTop3 = res.body.graduationPathways.top3 as {
      specialisations: string;
      explanation: string;
      fitScore: number;
    }[];
    expect(gradTop3).toHaveLength(1);
    expect(gradTop3[0].specialisations).toBe("Counsellor-Edited Specialization");
    expect(gradTop3[0].explanation).toBe("Counsellor-edited reasoning text");
    expect(gradTop3[0].fitScore).toBe(originalGrad.fitScore);
  });

  it("matches the counsellor chart's Career Compass table exactly once the counsellor has saved it", async () => {
    // Simulate a counsellor editing Step3SectionC on the frontend: delete the algorithmic
    // defaults and save a single custom row via the counsellor-chart PUT. This student
    // also still has the "Counsellor-Picked Role" library entry from the previous test —
    // proving the report ignores that fallback path once a chart table is saved, and
    // shows exactly (and only) the row the counsellor edited.
    const putRes = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentAId}`)
      .send({
        careerCompassTable: [
          {
            id: "cc-test-1",
            cluster: "Test Reports Cluster",
            industry: "Test Reports Industry",
            domain: "Test Reports Domain",
            role: "Chart-Edited Role",
            whyItFits: "Matches what the counsellor typed on the chart",
            topEmployers: "Acme, Globex",
            salaryIndia: "10-20 LPA",
            salaryAbroad: "$50k-90k",
            isManualEntry: true,
          },
        ],
      });
    expect(putRes.status).toBe(200);

    const res = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(200);
    const top6 = res.body.careerCompass.top6Domains as {
      addedByCounsellor: boolean;
      representativeCareer: { jobRole: string; oneLineDescription: string };
    }[];
    expect(top6).toHaveLength(1);
    expect(top6[0].representativeCareer.jobRole).toBe("Chart-Edited Role");
    expect(top6[0].representativeCareer.oneLineDescription).toBe(
      "Matches what the counsellor typed on the chart"
    );
    expect(top6[0].addedByCounsellor).toBe(true);
  });

  it("404s when the student has no assessment result yet", async () => {
    const res = await authRequest(app).get(`/api/v1/reports/students/${studentBId}/assessment`);
    expect(res.status).toBe(404);
  });

  it("accept: 400 until the chart is finalized, then accepts idempotently and is reflected on the GET", async () => {
    const before = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(before.body.accepted).toBe(false);
    expect(before.body.acceptedAt).toBeNull();

    // Accepting is student-only, no staff bypass — staff (the authRequest default) 403s.
    const staffTried = await authRequest(app).post(`/api/v1/reports/students/${studentAId}/accept`);
    expect(staffTried.status).toBe(403);

    const tooEarly = await request(app)
      .post(`/api/v1/reports/students/${studentAId}/accept`)
      .set("Authorization", studentAToken);
    expect(tooEarly.status).toBe(400);

    // Chart needs real content before it can be finalized.
    await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentAId}`)
      .send({ strengths: ["Curiosity"] });
    await authRequest(app).post(`/api/v1/counsellor-chart/students/${studentAId}/finalize`).send({});

    const accept = await request(app)
      .post(`/api/v1/reports/students/${studentAId}/accept`)
      .set("Authorization", studentAToken);
    expect(accept.status).toBe(200);
    expect(accept.body.acceptedAt).toBeTruthy();

    // Idempotent — re-accepting returns the same timestamp.
    const again = await request(app)
      .post(`/api/v1/reports/students/${studentAId}/accept`)
      .set("Authorization", studentAToken);
    expect(again.status).toBe(200);
    expect(again.body.acceptedAt).toBe(accept.body.acceptedAt);

    const after = await authRequest(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(after.body.accepted).toBe(true);
    expect(after.body.acceptedAt).toBe(accept.body.acceptedAt);

    // Accepted — the chart is now locked, even for staff.
    const editAfterAccept = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentAId}`)
      .send({ strengths: ["New idea"] });
    expect(editAfterAccept.status).toBe(409);
  });

  it("accept: 404 when the student has no assessment result yet", async () => {
    const res = await request(app)
      .post(`/api/v1/reports/students/${studentBId}/accept`)
      .set("Authorization", studentBToken);
    expect(res.status).toBe(404);
  });

  it("lets a student read their own report, but not another's", async () => {
    const own = await request(app).get(`/api/v1/reports/students/${studentAId}/assessment`).set("Authorization", studentAToken);
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/v1/reports/students/${studentBId}/assessment`).set("Authorization", studentAToken);
    expect(other.status).toBe(403);
  });

  it("401s without a token", async () => {
    const res = await request(app).get(`/api/v1/reports/students/${studentAId}/assessment`);
    expect(res.status).toBe(401);
  });
});
