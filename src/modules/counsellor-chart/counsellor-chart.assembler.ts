// Assembles the live Counsellor-Chart read-model for a student: profile + both
// pre-counselling questionnaires (side-by-side) + assessment result + flagged mirror
// pairs. Purely reads; the counsellor-authored content is layered on by the service.

import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import { ACADEMIC_RECORD_FIELDKEY, CHART_SECTIONS } from "./fieldmap.js";

const COHORT = "CLASS_9_10";

// Loads a pre-counselling submission's answers as a fieldKey -> answer map.
async function loadFormAnswers(
  studentId: string,
  formType: "PRE_COUNSELLING_STUDENT" | "PRE_COUNSELLING_PARENT"
): Promise<Map<string, unknown>> {
  const template = await prisma.formTemplate.findFirst({
    where: { formType, cohort: COHORT, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!template) return new Map();

  const submission = await prisma.formSubmission.findFirst({
    where: { studentId, formTemplateId: template.id },
    include: { answers: { include: { question: { select: { fieldKey: true } } } } },
  });
  if (!submission) return new Map();

  return new Map(submission.answers.map((a) => [a.question.fieldKey, a.answer]));
}

export async function assembleChart(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      division: {
        include: { class: { include: { institute: { select: { name: true, address: true } } } } },
      },
    },
  });
  if (!student) {
    throw new NotFoundError("Student not found");
  }

  const [studentAnswers, parentAnswers] = await Promise.all([
    loadFormAnswers(studentId, "PRE_COUNSELLING_STUDENT"),
    loadFormAnswers(studentId, "PRE_COUNSELLING_PARENT"),
  ]);

  // Latest submitted assessment result for this student.
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { studentId, status: "SUBMITTED" },
    orderBy: { submittedAt: "desc" },
    include: { result: true },
  });
  const report = (attempt?.result?.report ?? null) as Record<string, unknown> | null;

  const ourChampion = {
    name: `${student.user.firstName} ${student.user.lastName}`.trim(),
    currentAcademicYear: student.academicYear,
    institute: student.division.class.institute.name,
    instituteLocation: student.division.class.institute.address,
    class: student.division.class.name,
    division: student.division.name,
    fatherName: student.fatherName,
    fatherOccupationCompany: [student.fatherOccupation, student.fatherEmployer]
      .filter(Boolean)
      .join(", "),
    motherName: student.motherName,
    motherOccupationCompany: [student.motherOccupation, student.motherEmployer]
      .filter(Boolean)
      .join(", "),
  };

  const preCounselling = CHART_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    parameters: section.parameters.map((p) => ({
      code: p.code,
      group: p.group,
      label: p.label,
      student: p.student ? (studentAnswers.get(p.student) ?? null) : null,
      parent: p.parent ? (parentAnswers.get(p.parent) ?? null) : null,
    })),
  }));

  const academicRecord = studentAnswers.get(ACADEMIC_RECORD_FIELDKEY) ?? null;

  // Flagged mirror pairs: only the strong (gap-0) contradictions are shown for review.
  const rvs = (report?.reliability as { rvs?: { pairs?: { severity: string }[] } } | undefined)?.rvs;
  const flaggedMirrorPairs = (rvs?.pairs ?? []).filter((pair) => pair.severity === "strong");

  return {
    studentId,
    ourChampion,
    academicRecord,
    preCounselling,
    assessment: report, // full computed report (18 traits, styles, fits, reliability)
    flaggedMirrorPairs,
    hasAssessment: report != null,
  };
}
