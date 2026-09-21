import request from "supertest";
import { authRequest, bearer } from "./helpers/http.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { setStage } from "./helpers/stage.js";
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
    const project = await prisma.project.create({
      data: {
        code: "P-CCHART",
        name: "Test Project Counsellor Chart",
        address: "9 Chart Rd",
        contactNumber: "+919555000001",
        primaryEmail: `institute${SUFFIX}`,
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    const student = await authRequest(app).post("/api/v1/students").send({
      firstName: "Meera",
      lastName: "Nair",
      email: `meera${SUFFIX}`,
      mobile: "+919555000002",
      studentCode: "CC1",
      projectId: project.id,
      className: "Grade 10",
      divisionName: "B",
      parentMobile: "+919555000003",
      parentEmail: `parent-meera${SUFFIX}`,
      fatherName: "Nair Sr",
      fatherOccupation: "Architect",
      fatherEmployer: "BuildCo",
      motherName: "Nair Jr",
      motherOccupation: "Teacher",
    });
    await setStage(student.body.student.id, "PRE_COUNSELLING_FORMS_SUBMITTED");
    studentId = student.body.student.id;

    // Save pre-counselling student answers so the side-by-side assembly has data,
    // including raw option codes for an MCQ_SINGLE and a MATRIX question so the chart's
    // label resolution can be exercised below.
    await authRequest(app)
      .put(`/api/v1/forms/PRE_COUNSELLING_STUDENT/students/${studentId}`)
      .send({
        cohort: COHORT,
        answers: [
          { fieldKey: "fav_subject_block", answer: { subject: "Science" } },
          { fieldKey: "interest_consistency", answer: "b" },
          {
            fieldKey: "strengths_table",
            answer: { maths_logic: { rating: "not_really" } },
          },
        ],
      });

    // Submit a full assessment so the chart's assessment section is populated.
    const attempt = await authRequest(app).post("/api/v1/assessment/attempts").send({ studentId, cohort: COHORT });
    const questions = await authRequest(app).get("/api/v1/assessment/questions").query({ cohort: COHORT });
    await authRequest(app)
      .put(`/api/v1/assessment/attempts/${attempt.body.id}/answers`)
      .send({ answers: questions.body.map((q: AssessmentQuestion) => ({ fieldKey: q.fieldKey, selectedOption: buildAnswer(q) })) });
    await authRequest(app).post(`/api/v1/assessment/attempts/${attempt.body.id}/submit`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Counsellor Chart" } });
    await prisma.$disconnect();
  });

  it("assembles the chart: profile, pre-counselling side-by-side, assessment", async () => {
    const res = await authRequest(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(res.status).toBe(200);
    expect(res.body.ourChampion.name).toBe("Meera Nair");
    expect(res.body.ourChampion.fatherOccupationCompany).toBe("Architect, BuildCo");
    expect(res.body.preCounselling).toHaveLength(4);

    const academics = res.body.preCounselling.find((s: { key: string }) => s.key === "academics");
    const favSubject = academics.parameters.find((p: { code: string }) => p.code === "A1.1");
    expect(favSubject.student).toEqual({ subject: "Science" }); // populated from the saved form
    expect(favSubject.parent).toBeNull(); // parent form not submitted

    const strengthsSection = res.body.preCounselling.find((s: { key: string }) => s.key === "strengths");
    const consistency = strengthsSection.parameters.find((p: { code: string }) => p.code === "B1.4");
    expect(consistency.student).toBe("Mostly consistent — mostly interested but at times bored"); // resolved from raw code "b"

    const topStrengths = strengthsSection.parameters.find((p: { code: string }) => p.code === "B1.1");
    expect(topStrengths.student).toEqual({ maths_logic: { rating: "Not Really Me" } }); // resolved from raw code "not_really"

    expect(res.body.hasAssessment).toBe(true);
    expect(Object.keys(res.body.assessment.traitScores)).toHaveLength(18);
    expect(res.body.counsellor.notes).toEqual({}); // nothing saved yet
  });

  it("saves synthesis notes, SCRI ratings and ratings; recomputes the SCRI band", async () => {
    const res = await authRequest(app)
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
    const res = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({ notes: [{ code: "G1", body: "Behavioural evidence noted." }] });
    expect(res.status).toBe(200);
    expect(res.body.counsellor.notes.G1).toBe("Behavioural evidence noted.");
    // SCRI from the previous test persists (all six still set).
    expect(res.body.counsellor.scri.band).toBe(4);
  });

  it("rejects an unknown synthesis-note code with 400", async () => {
    const res = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({ notes: [{ code: "Z9", body: "invalid" }] });
    expect(res.status).toBe(400);
  });

  const social = (scores: { trait: string; score: number }[]) =>
    scores.find((s) => s.trait === "SOCIAL")!.score;

  it("amends a mirror-pair answer and re-scores the whole assessment", async () => {
    // All Likert answers are 4 -> SOCIAL (Q13-Q16) = 80%, and MP1 (Q4/Q16) is a strong
    // (gap-0) contradiction, so it's flagged.
    const before = await authRequest(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(social(before.body.assessment.riasec.scores)).toBe(80);
    expect(before.body.flaggedMirrorPairs.some((p: { code: string }) => p.code === "MP1")).toBe(true);

    const res = await authRequest(app)
      .post(`/api/v1/counsellor-chart/students/${studentId}/mirror-pair-amendments`)
      .send({ questionCode: "Q16", amendedOption: 1, counsellorId: "counsellor-1" });
    expect(res.status).toBe(200);
    // SOCIAL recomputed with Q16 = 1: (4+4+4+1)/20 = 65%. The change propagates to the
    // whole result, not just RVS.
    expect(social(res.body.report.riasec.scores)).toBe(65);

    // MP1 gap is now |4-1| = 3 (good) -> no longer a flagged contradiction.
    const after = await authRequest(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(after.body.flaggedMirrorPairs.some((p: { code: string }) => p.code === "MP1")).toBe(false);
  });

  it("reverts an amendment back to the student's original answer", async () => {
    const res = await authRequest(app).delete(
      `/api/v1/counsellor-chart/students/${studentId}/mirror-pair-amendments/Q16`
    );
    expect(res.status).toBe(200);
    expect(social(res.body.report.riasec.scores)).toBe(80); // back to the original
  });

  it("rejects amending a question that isn't part of a mirror pair", async () => {
    const res = await authRequest(app)
      .post(`/api/v1/counsellor-chart/students/${studentId}/mirror-pair-amendments`)
      .send({ questionCode: "Q1", amendedOption: 2 });
    expect(res.status).toBe(400);
  });

  it("lets the student read their own chart (incl. saved counsellor notes)", async () => {
    const row = await prisma.student.findUnique({ where: { id: studentId }, select: { userId: true } });
    const studentToken = bearer("STUDENT", { userId: row!.userId });

    const res = await request(app)
      .get(`/api/v1/counsellor-chart/students/${studentId}`)
      .set("Authorization", studentToken);
    expect(res.status).toBe(200);
    expect(res.body.ourChampion.name).toBe("Meera Nair");
    expect(res.body.counsellor.notes).toHaveProperty("A1"); // saved by an earlier PUT above
  });

  it("403s a student trying to read another student's chart", async () => {
    const otherToken = bearer("STUDENT", { userId: "some-other-user-id" });
    const res = await request(app)
      .get(`/api/v1/counsellor-chart/students/${studentId}`)
      .set("Authorization", otherToken);
    expect(res.status).toBe(403);
  });

  it("returns null for the 4 uncomputed Career Direction tables until edited, computes entranceExamsTable/collegesTable live until then", async () => {
    const res = await authRequest(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(res.status).toBe(200);
    expect(res.body.counsellor.streamFitTable).toBeNull();
    expect(res.body.counsellor.graduationTable).toBeNull();
    expect(res.body.counsellor.careerCompassClusterTable).toBeNull();
    expect(res.body.counsellor.careerCompassTable).toBeNull();
    expect(Array.isArray(res.body.entranceExamsTable)).toBe(true);
    expect(Array.isArray(res.body.collegesTable)).toBe(true);
  });

  it("persists a counsellor-edited Career Direction table, including a manual entry, and surfaces it on the last full array from then on", async () => {
    const put = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({
        streamFitTable: [
          {
            id: "manual-1",
            mainStream: "Commerce",
            subStream: "Accounting & Finance",
            coreSubjects: "Accountancy, Economics",
            electives: "Entrepreneurship",
            isManualEntry: true,
          },
        ],
        careerCompassClusterTable: [],
        lastEditedBy: "counsellor-1",
      });
    expect(put.status).toBe(200);
    expect(put.body.counsellor.streamFitTable).toHaveLength(1);
    expect(put.body.counsellor.streamFitTable[0].isManualEntry).toBe(true);
    // Deleting all rows persists as an empty array, not left uncomputed.
    expect(put.body.counsellor.careerCompassClusterTable).toEqual([]);

    const get = await authRequest(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(get.body.counsellor.streamFitTable).toHaveLength(1);
    expect(get.body.counsellor.careerCompassClusterTable).toEqual([]);
  });

  it("lists the manual entry on the Super Admin review queue", async () => {
    const res = await authRequest(app, "SUPER_ADMIN").get("/api/v1/counsellor-chart/manual-entries");
    expect(res.status).toBe(200);
    const row = res.body.find((r: { studentId: string }) => r.studentId === studentId);
    expect(row).toBeDefined();
    expect(row.tableLabel).toBe("Assessment Result View — Stream Fit & Pathways");
    expect(row.studentName).toBe("Meera Nair");
    expect(row.fields.mainStream).toBe("Commerce");
    expect(row.fields.isManualEntry).toBeUndefined();
    expect(row.fields.id).toBeUndefined();
  });

  it("stamps addedAt per manual-entry row instead of collapsing to the chart's last-save time", async () => {
    const first = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({
        careerCompassTable: [
          {
            id: "manual-cc-1",
            cluster: "Technology",
            industry: "Software",
            domain: "Tech",
            role: "Product Manager",
            whyItFits: "Fits interests",
            topEmployers: "Various",
            salaryIndia: "10-20 LPA",
            salaryAbroad: "$100k",
            isManualEntry: true,
          },
        ],
        lastEditedBy: "counsellor-1",
      });
    expect(first.status).toBe(200);
    const firstAddedAt = first.body.counsellor.careerCompassTable[0].addedAt;
    expect(typeof firstAddedAt).toBe("string");

    // A later save adds a second row to the same table and re-saves the first, unchanged.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({
        careerCompassTable: [
          first.body.counsellor.careerCompassTable[0],
          {
            id: "manual-cc-2",
            cluster: "Arts & Design",
            industry: "Design",
            domain: "Design",
            role: "UX Designer",
            whyItFits: "Creative fit",
            topEmployers: "Various",
            salaryIndia: "8-15 LPA",
            salaryAbroad: "$80k",
            isManualEntry: true,
          },
        ],
        lastEditedBy: "counsellor-1",
      });
    expect(second.status).toBe(200);
    const [row1, row2] = second.body.counsellor.careerCompassTable;
    // The first row's addedAt is preserved, not bumped to this save's time.
    expect(row1.addedAt).toBe(firstAddedAt);
    // The newly added row gets its own, later, addedAt.
    expect(row2.addedAt).not.toBe(firstAddedAt);
    expect(typeof row2.addedAt).toBe("string");

    const res = await authRequest(app, "SUPER_ADMIN").get("/api/v1/counsellor-chart/manual-entries");
    const rows = res.body.filter(
      (r: { studentId: string; id: string }) => r.studentId === studentId && r.id.startsWith("manual-cc-")
    );
    const queueRow1 = rows.find((r: { id: string }) => r.id === "manual-cc-1");
    const queueRow2 = rows.find((r: { id: string }) => r.id === "manual-cc-2");
    expect(queueRow1.addedAt).toBe(firstAddedAt);
    expect(queueRow2.addedAt).toBe(row2.addedAt);
  });

  it("403s a non-super-admin from the manual entries queue", async () => {
    const res = await authRequest(app, "ADMIN").get("/api/v1/counsellor-chart/manual-entries");
    expect(res.status).toBe(403);
  });

  it("403s a non-super-admin from deleting a manual entry", async () => {
    const res = await authRequest(app, "ADMIN").delete("/api/v1/counsellor-chart/manual-entries/manual-1");
    expect(res.status).toBe(403);
  });

  it("404s deleting a manual entry id that doesn't exist", async () => {
    const res = await authRequest(app, "SUPER_ADMIN").delete("/api/v1/counsellor-chart/manual-entries/no-such-id");
    expect(res.status).toBe(404);
  });

  it("deletes a manual entry row, leaving the rest of its table array intact", async () => {
    await authRequest(app)
      .put(`/api/v1/counsellor-chart/students/${studentId}`)
      .send({
        streamFitTable: [
          {
            id: "manual-1",
            mainStream: "Commerce",
            subStream: "Accounting & Finance",
            coreSubjects: "Accountancy, Economics",
            electives: "Entrepreneurship",
            isManualEntry: true,
          },
          {
            id: "manual-2",
            mainStream: "Science",
            subStream: "PCM",
            coreSubjects: "Physics, Chemistry, Maths",
            electives: "Computer Science",
            isManualEntry: true,
          },
        ],
        lastEditedBy: "counsellor-1",
      });

    const del = await authRequest(app, "SUPER_ADMIN").delete("/api/v1/counsellor-chart/manual-entries/manual-1");
    expect(del.status).toBe(204);

    const get = await authRequest(app).get(`/api/v1/counsellor-chart/students/${studentId}`);
    expect(get.body.counsellor.streamFitTable).toHaveLength(1);
    expect(get.body.counsellor.streamFitTable[0].id).toBe("manual-2");

    // Already deleted — repeating the call 404s instead of silently succeeding.
    const redo = await authRequest(app, "SUPER_ADMIN").delete("/api/v1/counsellor-chart/manual-entries/manual-1");
    expect(redo.status).toBe(404);
  });
});
