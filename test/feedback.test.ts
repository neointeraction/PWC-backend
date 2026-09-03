import argon2 from "argon2";
import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  computeCounsellorOverall,
  computeStudentFeedback,
  mapPerformanceBand,
  scoreForm,
  STUDENT_SECTIONS,
} from "../src/modules/feedback/feedback.scoring.js";

const app = createApp();
const COHORT = "CLASS_9_10";
const SUFFIX = "@test-feedback.example";

// --- pure scoring ---------------------------------------------------------------

describe("feedback scoring", () => {
  function uniform(prefixes: Record<string, number>): Map<string, number> {
    const m = new Map<string, number>();
    for (const [prefix, count] of Object.entries(prefixes)) {
      for (let i = 1; i <= count; i++) m.set(`${prefix}${i}`, 4);
    }
    return m;
  }

  it("maps final percentages to the four performance bands (top fully inclusive)", () => {
    expect(mapPerformanceBand(100).band).toBe("Top Performer");
    expect(mapPerformanceBand(90).band).toBe("Top Performer");
    expect(mapPerformanceBand(89.99).band).toBe("Strong Performer");
    expect(mapPerformanceBand(80).band).toBe("Strong Performer");
    expect(mapPerformanceBand(79.99).band).toBe("Needs Improvement");
    expect(mapPerformanceBand(70).band).toBe("Needs Improvement");
    expect(mapPerformanceBand(69.99).band).toBe("Critical");
    expect(mapPerformanceBand(69.99).incentive).toBe(0);
  });

  it("scores a section as (average ÷ 5) × 100 and weights across sections", () => {
    // S-SE all 5 (100%), S-CD all 4 (80%), S-OQ all 3 (60%), S-OS all 5 (100%).
    const answers = new Map<string, number>();
    ["sse_q1", "sse_q2", "sse_q3", "sse_q4"].forEach((k) => answers.set(k, 5));
    ["scd_q1", "scd_q2", "scd_q3", "scd_q4"].forEach((k) => answers.set(k, 4));
    ["soq_q1", "soq_q2", "soq_q3"].forEach((k) => answers.set(k, 3));
    ["sos_q1", "sos_q2"].forEach((k) => answers.set(k, 5));
    const form = scoreForm(answers, STUDENT_SECTIONS);
    expect(form.sections.find((s) => s.code === "S-SE")!.percent).toBe(100);
    expect(form.sections.find((s) => s.code === "S-OQ")!.percent).toBe(60);
    // 100×0.25 + 80×0.35 + 60×0.30 + 100×0.10 = 81
    expect(form.scorePercent).toBe(81);
  });

  it("combines student (80%) and parent (20%) into the final score + band", () => {
    // All 4s everywhere -> every section 80% -> both forms 80% -> final 80%.
    const student = uniform({ sse_q: 4, scd_q: 4, soq_q: 3, sos_q: 2 });
    const parent = uniform({ ppe_q: 3, pce_q: 4, poa_q: 3, pdc_q: 2, prc_q: 1 });
    const result = computeStudentFeedback(student, parent);
    expect(result.student.scorePercent).toBe(80);
    expect(result.parent.scorePercent).toBe(80);
    expect(result.finalPercent).toBe(80);
    expect(result.band).toBe("Strong Performer");
    expect(result.incentive).toBe(750);
  });

  it("averages student final scores for the counsellor overall (null if none)", () => {
    expect(computeCounsellorOverall([80, 90]).overallPercent).toBe(85);
    expect(computeCounsellorOverall([80, 90]).band).toBe("Strong Performer");
    expect(computeCounsellorOverall([])).toBeNull();
  });
});

// --- API integration ------------------------------------------------------------

let studentAId: string; // both feedback forms submitted
let studentBId: string; // only student form submitted
let counsellorId: string;

interface TemplateQuestion { fieldKey: string; questionType: string }

async function submitFeedback(studentId: string, formType: string, scaleValue: string): Promise<void> {
  const template = await authRequest(app).get(`/api/v1/forms/${formType}`).query({ cohort: COHORT });
  const answers = (template.body.questions as TemplateQuestion[]).map((q) => ({
    fieldKey: q.fieldKey,
    answer: q.questionType === "SCALE" ? scaleValue : "n/a",
  }));
  await authRequest(app)
    .post(`/api/v1/forms/${formType}/students/${studentId}/submit`)
    .send({ cohort: COHORT, answers });
}

describe("Feedback score API", () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        code: "P-FB",
        name: "Test Project Feedback",
        address: "10 Feedback Rd",
        contactNumber: "+919556000001",
        primaryEmail: `institute${SUFFIX}`,
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });

    async function makeStudent(n: number): Promise<string> {
      const res = await authRequest(app).post("/api/v1/students").send({
        firstName: "Fb", lastName: `Student${n}`, email: `student${n}${SUFFIX}`,
        mobile: `+91955600010${n}`, studentCode: `FB${n}`, projectId: project.id,
        className: "Grade 9", divisionName: "F",
        parentMobile: `+91955600020${n}`, parentEmail: `parent${n}${SUFFIX}`,
        fatherName: "F", fatherOccupation: "Eng", motherName: "M", motherOccupation: "Dr",
      });
      return res.body.student.id;
    }
    studentAId = await makeStudent(1);
    studentBId = await makeStudent(2);

    // Student A: both forms complete (all 4s -> final 80%). Student B: student form only.
    await submitFeedback(studentAId, "FEEDBACK_STUDENT", "4");
    await submitFeedback(studentAId, "FEEDBACK_PARENT", "4");
    await submitFeedback(studentBId, "FEEDBACK_STUDENT", "4");

    // Counsellor with a session for each student (B's pair is incomplete -> excluded).
    const counsellorUser = await prisma.user.create({
      data: {
        email: `counsellor${SUFFIX}`, passwordHash: await argon2.hash("x"),
        role: "COUNSELLOR", firstName: "Coun", lastName: "Sellor",
      },
    });
    const counsellor = await prisma.counsellor.create({
      data: { userId: counsellorUser.id, counsellorCode: "FB-CN1", mobile: "+919556000301" },
    });
    counsellorId = counsellor.id;
    const times = ["10:00", "11:00"]; // distinct — counsellor slots are unique per (date, start)
    for (const [i, studentId] of [studentAId, studentBId].entries()) {
      await prisma.session.create({
        data: {
          studentId, counsellorId, sessionNumber: "SESSION_1",
          scheduledDate: new Date("2026-06-01"), startTime: times[i]!, endTime: "10:30",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { counsellorId } });
    await prisma.counsellor.deleteMany({ where: { id: counsellorId } });
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.project.deleteMany({ where: { name: "Test Project Feedback" } });
    await prisma.$disconnect();
  });

  it("computes a student's final score when both feedback forms are complete", async () => {
    const res = await authRequest(app).get(`/api/v1/feedback/students/${studentAId}/score`);
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.score.finalPercent).toBe(80);
    expect(res.body.score.band).toBe("Strong Performer");
    expect(res.body.score.incentive).toBe(750);
    expect(res.body.score.student.sections).toHaveLength(4);
    expect(res.body.score.parent.sections).toHaveLength(5);
  });

  it("reports an incomplete pair instead of a score", async () => {
    const res = await authRequest(app).get(`/api/v1/feedback/students/${studentBId}/score`);
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.missingForms).toContain("FEEDBACK_PARENT");
    expect(res.body.score).toBeUndefined();
  });

  it("averages only complete-pair students for the counsellor overall score", async () => {
    const res = await authRequest(app).get(`/api/v1/feedback/counsellors/${counsellorId}/score`);
    expect(res.status).toBe(200);
    expect(res.body.totalStudents).toBe(2);
    expect(res.body.includedStudents).toBe(1); // only student A has both forms
    expect(res.body.excludedStudents).toBe(1);
    expect(res.body.overall.overallPercent).toBe(80);
    expect(res.body.overall.band).toBe("Strong Performer");
    expect(res.body.overall.incentive).toBe(750);
  });
});
