import { prisma } from "../../config/prisma.js";
import type { ListAssessmentQuestionsQuery } from "./assessment.schema.js";

// `correctOption` is deliberately excluded from every response — it's the answer key
// for scored aptitude questions and must never be exposed to whoever is taking the
// assessment (student-facing or otherwise).
const assessmentQuestionSelect = {
  id: true,
  cohort: true,
  section: true,
  order: true,
  questionCode: true,
  fieldKey: true,
  questionText: true,
  format: true,
  options: true,
  trait: true,
  traitCode: true,
  difficulty: true,
  weight: true,
} as const;

export async function listAssessmentQuestions(query: ListAssessmentQuestionsQuery) {
  return prisma.assessmentQuestion.findMany({
    where: {
      cohort: query.cohort,
      section: query.section,
    },
    orderBy: { order: "asc" },
    select: assessmentQuestionSelect,
  });
}
