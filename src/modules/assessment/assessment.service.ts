import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { assertStudentProjectWindowOpen } from "../../common/utils/projectWindow.js";
import { scoreAssessment } from "./scoring/index.js";
import { aiResilienceRank, type DomainUnit, type RepresentativeCareer } from "./scoring/careerFit.js";
import { MIRROR_PAIRS } from "./scoring/config.js";
import type { AnsweredQuestion, Difficulty, Layer, TraitKey } from "./scoring/types.js";

// Every question code that participates in a mirror pair — the only answers a counsellor
// may amend from the Counsellor Chart.
const MIRROR_PAIR_QUESTION_CODES = new Set(MIRROR_PAIRS.flatMap((p) => [p.a, p.b]));
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
  displayOrder: true,
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
    // Student-facing: return in the questionnaire's interleaved presentation order.
    orderBy: { displayOrder: "asc" },
    select: assessmentQuestionSelect,
  });
}

// Starts a new attempt, or returns the existing in-progress one for this
// student+cohort so re-opening the assessment resumes rather than restarting.
export async function startOrResumeAttempt(input: StartAttemptBody) {
  // No login on this flow — reject once the student's project has ended/closed. Also
  // 404s an unknown student.
  await assertStudentProjectWindowOpen(input.studentId);

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

  await advanceWorkflowStatus(prisma, input.studentId, "ASSESSMENT_PENDING");

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
  await assertStudentProjectWindowOpen(attempt.studentId);

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
  await assertStudentProjectWindowOpen(attempt.studentId);

  const questions = await prisma.assessmentQuestion.findMany({ where: { cohort: attempt.cohort } });
  const answeredQuestionIds = new Set(attempt.answers.map((a) => a.questionId));
  const missing = questions.filter((q) => !answeredQuestionIds.has(q.id));
  if (missing.length > 0) {
    throw new BadRequestError("Missing answers for one or more questions", {
      missingFieldKeys: missing.map((q) => q.fieldKey),
      missingCount: missing.length,
    });
  }

  const submittedAt = new Date();
  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { status: "SUBMITTED", submittedAt },
  });

  await advanceWorkflowStatus(prisma, attempt.studentId, "ASSESSMENT_COMPLETED");

  // Score the completed attempt and persist the computed report. Guarded so a scoring
  // bug can't strand a submitted-but-locked attempt with no result — the attempt is
  // already SUBMITTED above; getAssessmentResult reports a missing result cleanly.
  try {
    await computeAndStoreResult(attemptId, questions, attempt.answers, attempt.startedAt, submittedAt);
  } catch (err) {
    console.error(`Assessment scoring failed for attempt ${attemptId}:`, err);
  }

  return getAttempt(attemptId);
}

// Normalizes an answer's stored value to the raw scalar the scoring engine expects
// (a 1-5 number for Likert, "A".."E" for aptitude). Tolerates a `{ value }` wrapper.
function normalizeResponse(selectedOption: unknown): number | string | null {
  if (selectedOption == null) return null;
  if (typeof selectedOption === "object" && "value" in selectedOption) {
    const v = (selectedOption as { value: unknown }).value;
    return typeof v === "number" || typeof v === "string" ? v : null;
  }
  return typeof selectedOption === "number" || typeof selectedOption === "string"
    ? selectedOption
    : null;
}

type AttemptQuestion = Awaited<ReturnType<typeof prisma.assessmentQuestion.findMany>>[number];
type AttemptAnswer = {
  questionId: string;
  selectedOption: unknown;
  counsellorOverrideOption: unknown;
  timeTakenMs: number | null;
};

async function computeAndStoreResult(
  attemptId: string,
  questions: AttemptQuestion[],
  answers: AttemptAnswer[],
  startedAt: Date,
  submittedAt: Date
): Promise<void> {
  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));

  const normalized: AnsweredQuestion[] = questions.map((q) => {
    const answer = answerByQuestionId.get(q.id);
    return {
      questionCode: q.questionCode,
      section: q.section as Layer,
      trait: q.trait as TraitKey,
      traitCode: q.traitCode,
      difficulty: (q.difficulty as Difficulty | null) ?? null,
      weight: q.weight,
      correctOption: q.correctOption,
      format: q.format,
      order: q.order,
      // A counsellor's mirror-pair amendment overrides the student's answer; the
      // original selectedOption is preserved on the row for audit.
      response: normalizeResponse(answer?.counsellorOverrideOption ?? answer?.selectedOption),
      timeTakenMs: answer?.timeTakenMs ?? null,
    };
  });

  // Career Fit needs the career library: distinct (cluster, industry, domain) tuples
  // plus, per (industry, domain), the roles available and their AI-resilience (the
  // representative-career tiebreak). Fetched once here — submit is infrequent.
  const { domainUnits, careersByKey } = await loadCareerLibraryForFit();

  const report = scoreAssessment({
    answers: normalized,
    startedAt,
    submittedAt,
    domainUnits: domainUnits.length > 0 ? domainUnits : undefined,
  });

  // Resolve the representative career for each of the top-6 domains: highest
  // AI-resilience role in that (industry, domain), tie-broken by job-role name.
  if (report.careerFit) {
    for (const domainFit of report.careerFit.top6Domains) {
      const roles = careersByKey.get(`${domainFit.industry}||${domainFit.domain}`) ?? [];
      const best = roles
        .slice()
        .sort(
          (a, b) =>
            aiResilienceRank(b.aiResilienceGrade) - aiResilienceRank(a.aiResilienceGrade) ||
            a.jobRole.localeCompare(b.jobRole)
        )[0];
      domainFit.representativeCareer = best ?? null;
    }
  }

  await prisma.assessmentResult.upsert({
    where: { attemptId },
    update: {
      traitScores: report.traitScores,
      report: report as never,
      recommendedStreams: report.streamFit.top3.map((s) => s.subStream),
      dominantCareerStyle: report.dominantCareerStyle.style,
      dominantPersonalityStyle: report.dominantPersonalityStyle.style,
      engineVersion: "v1",
    },
    create: {
      attemptId,
      traitScores: report.traitScores,
      report: report as never,
      recommendedStreams: report.streamFit.top3.map((s) => s.subStream),
      dominantCareerStyle: report.dominantCareerStyle.style,
      dominantPersonalityStyle: report.dominantPersonalityStyle.style,
      engineVersion: "v1",
    },
  });
}

// Re-runs the full scoring engine for a submitted attempt (used after a counsellor
// amends an answer). Uses each answer's override when present.
async function recomputeAssessmentResult(attemptId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { answers: true },
  });
  if (!attempt) {
    throw new NotFoundError("Assessment attempt not found");
  }
  const questions = await prisma.assessmentQuestion.findMany({ where: { cohort: attempt.cohort } });
  await computeAndStoreResult(
    attemptId,
    questions,
    attempt.answers,
    attempt.startedAt,
    attempt.submittedAt ?? new Date()
  );
  return prisma.assessmentResult.findUnique({ where: { attemptId } });
}

async function getSubmittedAttemptForStudent(studentId: string) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { studentId, status: "SUBMITTED" },
    orderBy: { submittedAt: "desc" },
  });
  if (!attempt) {
    throw new NotFoundError("No submitted assessment found for this student");
  }
  return attempt;
}

async function findAmendableAnswer(attemptId: string, cohort: string, questionCode: string) {
  if (!MIRROR_PAIR_QUESTION_CODES.has(questionCode)) {
    throw new BadRequestError(
      `Question "${questionCode}" is not a mirror-pair question and cannot be amended`
    );
  }
  const question = await prisma.assessmentQuestion.findFirst({ where: { cohort, questionCode } });
  if (!question) {
    throw new NotFoundError(`Question "${questionCode}" not found for this cohort`);
  }
  return question;
}

// Applies a counsellor's mirror-pair amendment (Counsellor Chart): overrides the
// student's answer, preserves the original, and re-scores the whole attempt.
export async function applyMirrorPairAmendment(
  studentId: string,
  questionCode: string,
  amendedOption: number,
  counsellorId?: string
) {
  const attempt = await getSubmittedAttemptForStudent(studentId);
  const question = await findAmendableAnswer(attempt.id, attempt.cohort, questionCode);

  await prisma.assessmentAnswer.update({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
    data: {
      counsellorOverrideOption: amendedOption as never,
      overriddenByCounsellorId: counsellorId ?? null,
      overriddenAt: new Date(),
    },
  });

  return recomputeAssessmentResult(attempt.id);
}

// Reverts a mirror-pair amendment back to the student's original answer, then re-scores.
export async function revertMirrorPairAmendment(studentId: string, questionCode: string) {
  const attempt = await getSubmittedAttemptForStudent(studentId);
  const question = await findAmendableAnswer(attempt.id, attempt.cohort, questionCode);

  await prisma.assessmentAnswer.update({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
    data: { counsellorOverrideOption: Prisma.DbNull, overriddenByCounsellorId: null, overriddenAt: null },
  });

  return recomputeAssessmentResult(attempt.id);
}

// Loads the career library once and derives (a) the DomainUnit list Career Fit ranks
// over and (b) an index of full career rows per (industry, domain) for representative-
// career resolution.
async function loadCareerLibraryForFit(): Promise<{
  domainUnits: DomainUnit[];
  careersByKey: Map<string, RepresentativeCareer[]>;
}> {
  const entries = await prisma.careerLibraryEntry.findMany({
    where: { status: "ACTIVE" },
    select: {
      cluster: true,
      industry: true,
      domain: true,
      jobRole: true,
      aiResilienceGrade: true,
      aiResilienceComment: true,
      oneLineDescription: true,
      topCompanies: true,
      salaryIndiaRangeText: true,
      salaryGlobalRangeText: true,
    },
  });

  const careersByKey = new Map<string, RepresentativeCareer[]>();
  const bestRankByDomain = new Map<string, DomainUnit>();

  for (const e of entries) {
    const key = `${e.industry}||${e.domain}`;
    const career: RepresentativeCareer = {
      jobRole: e.jobRole,
      cluster: e.cluster,
      industry: e.industry,
      domain: e.domain,
      aiResilienceGrade: e.aiResilienceGrade,
      aiResilienceComment: e.aiResilienceComment,
      oneLineDescription: e.oneLineDescription,
      topCompanies: e.topCompanies,
      salaryIndiaRangeText: e.salaryIndiaRangeText,
      salaryGlobalRangeText: e.salaryGlobalRangeText,
    };
    const list = careersByKey.get(key) ?? [];
    list.push(career);
    careersByKey.set(key, list);

    const rank = aiResilienceRank(e.aiResilienceGrade);
    const existing = bestRankByDomain.get(key);
    if (!existing || rank > existing.bestAiResilienceRank) {
      bestRankByDomain.set(key, {
        cluster: e.cluster,
        industry: e.industry,
        domain: e.domain,
        bestAiResilienceRank: rank,
      });
    }
  }

  return { domainUnits: [...bestRankByDomain.values()], careersByKey };
}

export async function getAssessmentResult(attemptId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) {
    throw new NotFoundError("Assessment attempt not found");
  }
  const result = await prisma.assessmentResult.findUnique({ where: { attemptId } });
  if (!result) {
    throw new NotFoundError(
      attempt.status === "SUBMITTED"
        ? "Result not available for this attempt"
        : "Attempt has not been submitted yet"
    );
  }
  return result;
}

export async function getAttempt(attemptId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: {
        include: { question: { select: assessmentQuestionSelect } },
        orderBy: { question: { displayOrder: "asc" } },
      },
    },
  });
  if (!attempt) {
    throw new NotFoundError("Assessment attempt not found");
  }
  return attempt;
}
