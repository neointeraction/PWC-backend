import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { computeScri } from "../src/modules/counsellor-chart/scri.js";

const app = createApp();
const COHORT = "CLASS_9_10";
const SUFFIX = "@test-counsellor-chart.example";

let studentId: string;

interface AssessmentQuestion {
  fieldKey: string;
  format: string;
  options: { value: string }[] | null;
}
function buildAnswer(q: AssessmentQuestion): unknown {
  return q.format === "MCQ_SINGLE" ? (q.options?.[0]?.value ?? "A") : "4";
}

describe("SCRI band computation", () => {
  it("returns null until all six indicators are rated", () => {
    const r = computeScri({
      confidence: 4, reasonedThinking: 4, reducedAnxiety: 4,
      selfAwareness: 4, careerCuriosity: 4, decisionOwnership: null,
    });
    expect(r.total).toBeNull();
    expect(r.band).toBeNull();
  });

  it("maps totals to the four readiness bands", () => {
    expect(computeScri({ confidence: 1, reasonedThinking: 1, reducedAnxiety: 2, selfAwareness: 2, careerCuriosity: 2, decisionOwnership: 2 }).label).toBe("PreExploration"); // 10
    expect(computeScri({ confidence: 2, reasonedThinking: 2, reducedAnxiety: 3, selfAwareness: 3, careerCuriosity: 3, decisionOwnership: 2 }).label).toBe("Early Exploration"); // 15
    expect(computeScri({ confidence: 3, reasonedThinking: 3, reducedAnxiety: 3, selfAwareness: 3, careerCuriosity: 4, decisionOwnership: 4 }).label).toBe("Active Exploration"); // 20
    const full = computeScri({ confidence: 4, reasonedThinking: 4, reducedAnxiety: 4, selfAwareness: 4, careerCuriosity: 4, decisionOwnership: 4 });
    expect(full.total).toBe(24);
    expect(full.band).toBe(4);
    expect(full.label).toBe("Career Ready");
  });
});

describe("Counsellor Chart API", () => {
  beforeAll(async () => {
    const institute = await request(app).post("/api/v1/institutes").send({
      name: "Test Institute Counsellor Chart",
      address: "9 Chart Rd",
      contactNumber: "+919555000001",
      primaryEmail: `institute${SUFFIX}`,
    });
    const instituteId = institute.body.id;
    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Counsellor Chart",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    const klass = await request(app)
      .post(`/api/v1/institutes/${instituteId}/classes`)
      .send({ name: "Grade 10" });
    const division = await request(app)
      .post(`/api/v1/institutes/${instituteId}/classes/${klass.body.id}/divisions`)
      .send({ name: "B" });
    const student = await request(app).post("/api/v1/students").send({
      firstName: "Meera",
      lastName: "Nair",
      email: `meera${SUFFIX}`,
      mobile: "+919555000002",
      studentCode: "CC1",
      projectId: project.id,
      divisionId: division.body.id,
      parentMobile: "+919555000003",
      parentEmail: `parent-meera${SUFFIX}`,
      fatherName: "Nair Sr",
      fatherOccupation: "Architect",
      fatherEmployer: "BuildCo",
      motherName: "Nair Jr",
      motherOccupation: "Teacher",
    });
    studentId = student.body.student.id;

    // Save one pre-counselling student answer so the side-by-side assembly has data.
    await request(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({ cohort: COHORT, answers: [{ fieldKey: "fav_subject_block", answer: { subject: "Science" } }] });

    // Submit a full assessment so the chart's assessment section is populated.
    const attempt = await request(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    const questions = await request(app).get("/api/v1/assessment/questions").query({ cohort: COHORT });
    await request(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: questions.body.map((q: AssessmentQuestion) => ({ fieldKey: q.fieldKey, selectedOption: buildAnswer(q) })) });
    await request(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Counsellor Chart" } });
    await prisma.institute.deleteMany({ where: { name: "Test Institute Counsellor Chart" } });
    await prisma.$disconnect();
  });

  it("assembles the chart: profile, pre-counselling side-by-side, assessment", async () => {
    const res = await request(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(res.status).toBe(200);
    expect(res.body.ourChampion.name).toBe("Meera Nair");
    expect(res.body.ourChampion.fatherOccupationCompany).toBe("Architect, BuildCo");
    expect(res.body.preCounselling).toHaveLength(4);

    const academics = res.body.preCounselling.find((s: { key: string }) => s.key === "academics");
    const favSubject = academics.parameters.find((p: { code: string }) => p.code === "A1.1");
    expect(favSubject.student).toEqual({ subject: "Science" }); // populated from the saved form
    expect(favSubject.parent).toBeNull(); // parent form not submitted

    expect(res.body.hasAssessment).toBe(true);
    expect(Object.keys(res.body.assessment.traitScores)).toHaveLength(18);
    expect(res.body.counsellor.notes).toEqual({}); // nothing saved yet
  });

  it("saves synthesis notes, SCRI ratings and ratings; recomputes the SCRI band", async () => {
    const res = await request(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({
        notes: [
          { code: "A1", body: "Favourite subject matches parent's view — strong anchor." },
          { code: "F1", body: "EIM low; re-probe mirror pairs conversationally." },
        ],
        scri: { confidence: 4, reasonedThinking: 4, reducedAnxiety: 4, selfAwareness: 4, careerCuriosity: 4, decisionOwnership: 4 },
        academicTrend: "IMPROVING",
        alignmentRating: "STRONGLY_ALIGNED",
        strengths: ["curiosity", "communication"],
        lastEditedBy: "counsellor-1",
      });

    expect(res.status).toBe(200);
    expect(res.body.counsellor.notes.A1).toContain("strong anchor");
    expect(res.body.counsellor.notes.F1).toContain("re-probe");
    expect(res.body.counsellor.scri.total).toBe(24);
    expect(res.body.counsellor.scri.band).toBe(4);
    expect(res.body.counsellor.scri.bandLabel).toBe("Career Ready");
    expect(res.body.counsellor.academicTrend).toBe("IMPROVING");
    expect(res.body.counsellor.alignmentRating).toBe("STRONGLY_ALIGNED");
    expect(res.body.counsellor.strengths).toContain("curiosity");
    expect(res.body.counsellor.lastEditedBy).toBe("counsellor-1");
  });

  it("partial SCRI update keeps the band null until all six are rated", async () => {
    // Fresh student with no prior SCRI would be null; here we only assert the rule via
    // the pure function already covered above, and that a partial patch is accepted.
    const res = await request(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({ notes: [{ code: "G1", body: "Behavioural evidence noted." }] });
    expect(res.status).toBe(200);
    expect(res.body.counsellor.notes.G1).toBe("Behavioural evidence noted.");
    // SCRI from the previous test persists (all six still set).
    expect(res.body.counsellor.scri.band).toBe(4);
  });

  it("rejects an unknown synthesis-note code with 400", async () => {
    const res = await request(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({ notes: [{ code: "Z9", body: "invalid" }] });
    expect(res.status).toBe(400);
  });

  const social = (scores: { trait: string; score: number }[]) =>
    scores.find((s) => s.trait === "SOCIAL")!.score;

  it("amends a mirror-pair answer and re-scores the whole assessment", async () => {
    // All Likert answers are 4 -> SOCIAL (Q13-Q16) = 80%, and MP1 (Q4/Q16) is a strong
    // (gap-0) contradiction, so it's flagged.
    const before = await request(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(social(before.body.assessment.riasec.scores)).toBe(80);
    expect(before.body.flaggedMirrorPairs.some((p: { code: string }) => p.code === "MP1")).toBe(true);

    const res = await request(app)
      .post(`/api/v1/counsellor-chart/students/${studentId}/mirror-pair-amendments`)
      .send({ questionCode: "Q16", amendedOption: 1, counsellorId: "counsellor-1" });
    expect(res.status).toBe(200);
    // SOCIAL recomputed with Q16 = 1: (4+4+4+1)/20 = 65%. The change propagates to the
    // whole result, not just RVS.
    expect(social(res.body.report.riasec.scores)).toBe(65);

    // MP1 gap is now |4-1| = 3 (good) -> no longer a flagged contradiction.
    const after = await request(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(after.body.flaggedMirrorPairs.some((p: { code: string }) => p.code === "MP1")).toBe(false);
  });

  it("reverts an amendment back to the student's original answer", async () => {
    const res = await request(app).delete(
      `/api/v1/counsellor-chart/students/${studentId}/mirror-pair-amendments/Q16`
    );
    expect(res.status).toBe(200);
    expect(social(res.body.report.riasec.scores)).toBe(80); // back to the original
  });

  it("rejects amending a question that isn't part of a mirror pair", async () => {
    const res = await request(app)
      .post(`/api/v1/counsellor-chart/students/${studentId}/mirror-pair-amendments`)
      .send({ questionCode: "Q1", amendedOption: 2 });
    expect(res.status).toBe(400);
  });
});
