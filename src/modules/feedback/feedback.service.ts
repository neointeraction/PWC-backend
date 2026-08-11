import type { FormType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import {
  computeCounsellorOverall,
  computeStudentFeedback,
  parseScale,
} from "./feedback.scoring.js";

const COHORT = "CLASS_9_10";

interface LoadedForm {
  submitted: boolean;
  answers: Map<string, number>;
}

// Loads a student's feedback submission and its numeric (scale) answers by fieldKey.
async function loadFeedbackForm(studentId: string, formType: FormType): Promise<LoadedForm> {
  const template = await prisma.formTemplate.findFirst({
    where: { formType, cohort: COHORT, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!template) return { submitted: false, answers: new Map() };

  const submission = await prisma.formSubmission.findFirst({
    where: { studentId, formTemplateId: template.id },
    include: { answers: { include: { question: { select: { fieldKey: true } } } } },
  });
  if (!submission) return { submitted: false, answers: new Map() };

  const answers = new Map<string, number>();
  for (const a of submission.answers) {
    const value = parseScale(a.answer);
    if (value !== null) answers.set(a.question.fieldKey, value);
  }
  // Only a finalized (submitted) form counts — incomplete pairs are excluded.
  return { submitted: submission.submittedAt !== null, answers };
}

export interface StudentFeedbackResult {
  studentId: string;
  complete: boolean;
  missingForms?: FormType[];
  score?: ReturnType<typeof computeStudentFeedback>;
}

// Computes a single student's Counsellor Satisfaction Final Score %. Returns
// complete:false (not an error) when either feedback form is missing/unsubmitted, so
// callers can distinguish "incomplete pair" from "student not found".
export async function getStudentFeedbackScore(studentId: string): Promise<StudentFeedbackResult> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    throw new NotFoundError("Student not found");
  }

  const [studentForm, parentForm] = await Promise.all([
    loadFeedbackForm(studentId, "FEEDBACK_STUDENT"),
    loadFeedbackForm(studentId, "FEEDBACK_PARENT"),
  ]);

  const missingForms: FormType[] = [];
  if (!studentForm.submitted) missingForms.push("FEEDBACK_STUDENT");
  if (!parentForm.submitted) missingForms.push("FEEDBACK_PARENT");
  if (missingForms.length > 0) {
    return { studentId, complete: false, missingForms };
  }

  return {
    studentId,
    complete: true,
    score: computeStudentFeedback(studentForm.answers, parentForm.answers),
  };
}

export interface CounsellorFeedbackResult {
  counsellorId: string;
  totalStudents: number; // students with at least one session under this counsellor
  includedStudents: number; // both feedback forms complete
  excludedStudents: number; // incomplete pairs, excluded from the score
  overall: ReturnType<typeof computeCounsellorOverall>;
  sessions: { studentId: string; finalPercent: number; band: string }[];
}

// Averages Final Score % across all of a counsellor's students whose feedback pair is
// complete (methodology step 6). Students are linked via their Sessions.
export async function getCounsellorFeedbackScore(
  counsellorId: string
): Promise<CounsellorFeedbackResult> {
  const counsellor = await prisma.counsellor.findUnique({ where: { id: counsellorId } });
  if (!counsellor) {
    throw new NotFoundError("Counsellor not found");
  }

  const studentRows = await prisma.session.findMany({
    where: { counsellorId },
    select: { studentId: true },
    distinct: ["studentId"],
  });

  const sessions: { studentId: string; finalPercent: number; band: string }[] = [];
  let excluded = 0;
  for (const { studentId } of studentRows) {
    const result = await getStudentFeedbackScore(studentId);
    if (result.complete && result.score) {
      sessions.push({
        studentId,
        finalPercent: result.score.finalPercent,
        band: result.score.band,
      });
    } else {
      excluded += 1;
    }
  }

  return {
    counsellorId,
    totalStudents: studentRows.length,
    includedStudents: sessions.length,
    excludedStudents: excluded,
    overall: computeCounsellorOverall(sessions.map((s) => s.finalPercent)),
    sessions,
  };
}
