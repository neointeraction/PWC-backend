import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import type {
  ListAssessmentQuestionsQuery,
  SaveAssessmentAnswersBody,
  StartAttemptBody,
} from "./assessment.schema.js";

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

async function assertStudentExists(studentId: string): Promise<void> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    throw new NotFoundError("Student not found");
  }
}

// Starts a new attempt, or returns the existing in-progress one for this
// student+cohort so re-opening the assessment resumes rather than restarting.
export async function startOrResumeAttempt(input: StartAttemptBody) {
  await assertStudentExists(input.studentId);

  const alreadySubmitted = await prisma.assessmentAttempt.findFirst({
    where: { studentId: input.studentId, cohort: input.cohort, status: "SUBMITTED" },
  });
  if (alreadySubmitted) {
    throw new ConflictError("Assessment already submitted for this cohort");
  }

  const inProgress = await prisma.assessmentAttempt.findFirst({
    where: { studentId: input.studentId, cohort: input.cohort, status: "IN_PROGRESS" },
  });
  if (inProgress) {
    return getAttempt(inProgress.id);
  }

  const questionCount = await prisma.assessmentQuestion.count({ where: { cohort: input.cohort } });
  if (questionCount === 0) {
    throw new NotFoundError(`No assessment question bank found for cohort "${input.cohort}"`);
  }

  const attempt = await prisma.assessmentAttempt.create({
    data: { studentId: input.studentId, cohort: input.cohort },
  });

  return getAttempt(attempt.id);
}

export async function saveAssessmentAnswers(attemptId: string, input: SaveAssessmentAnswersBody) {
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) {
    throw new NotFoundError("Assessment attempt not found");
  }
  if (attempt.status === "SUBMITTED") {
    throw new ConflictError("This attempt has already been submitted and is locked");
  }

  const questions = await prisma.assessmentQuestion.findMany({ where: { cohort: attempt.cohort } });
  const questionsByFieldKey = new Map(questions.map((q) => [q.fieldKey, q]));

  for (const a of input.answers) {
    if (!questionsByFieldKey.has(a.fieldKey)) {
      throw new BadRequestError(`Unknown question fieldKey "${a.fieldKey}" for this cohort`);
    }
  }

  await prisma.$transaction(
    input.answers.map((a) => {
      const question = questionsByFieldKey.get(a.fieldKey)!;
      return prisma.assessmentAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: question.id } },
        update: { selectedOption: a.selectedOption as never },
        create: { attemptId, questionId: question.id, selectedOption: a.selectedOption as never },
      });
    })
  );

  return getAttempt(attemptId);
}

export async function submitAttempt(attemptId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { answers: true },
  });
  if (!attempt) {
    throw new NotFoundError("Assessment attempt not found");
  }
  if (attempt.status === "SUBMITTED") {
    throw new ConflictError("This attempt has already been submitted and is locked");
  }

  const questions = await prisma.assessmentQuestion.findMany({ where: { cohort: attempt.cohort } });
  const answeredQuestionIds = new Set(attempt.answers.map((a) => a.questionId));
  const missing = questions.filter((q) => !answeredQuestionIds.has(q.id));
  if (missing.length > 0) {
    throw new BadRequestError("Missing answers for one or more questions", {
      missingFieldKeys: missing.map((q) => q.fieldKey),
      missingCount: missing.length,
    });
  }

  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  // PWC's scoring/weighting logic isn't supplied yet (see docs/db-design.md), so no
  // AssessmentResult is computed here — submission only validates completeness and
  // locks the attempt.
  return getAttempt(attemptId);
}

export async function getAttempt(attemptId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: {
        include: { question: { select: assessmentQuestionSelect } },
        orderBy: { question: { order: "asc" } },
      },
    },
  });
  if (!attempt) {
    throw new NotFoundError("Assessment attempt not found");
  }
  return attempt;
}
