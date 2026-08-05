import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import type { FormTypeParams, GetFormTemplateQuery, SaveFormAnswersBody } from "./forms.schema.js";

type FormType = FormTypeParams["formType"];
type SubmittedByRole = "STUDENT" | "PARENT";

// Every form type is filled by exactly one role in practice — see docs/db-design.md.
const FORM_TYPE_TO_ROLE: Record<FormType, SubmittedByRole> = {
  STUDENT_PROFILE: "STUDENT",
  PRE_COUNSELLING_STUDENT: "STUDENT",
  FEEDBACK_STUDENT: "STUDENT",
  PRE_COUNSELLING_PARENT: "PARENT",
  FEEDBACK_PARENT: "PARENT",
};

async function resolveTemplateOrThrow(formType: FormType, cohort: string, version?: number) {
  const template = await prisma.formTemplate.findFirst({
    where: {
      formType,
      cohort,
      ...(version ? { version } : { isActive: true }),
    },
    orderBy: { version: "desc" },
    include: {
      questions: { orderBy: { order: "asc" } },
    },
  });

  if (!template) {
    throw new NotFoundError(
      `No ${formType} form found for cohort "${cohort}"${version ? ` version ${version}` : ""}`
    );
  }

  return template;
}

async function assertStudentExists(studentId: string): Promise<void> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    throw new NotFoundError("Student not found");
  }
}

function isAnswerEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export async function getFormTemplate(formType: FormType, query: GetFormTemplateQuery) {
  return resolveTemplateOrThrow(formType, query.cohort, query.version);
}

export async function saveFormAnswers(
  formType: FormType,
  studentId: string,
  input: SaveFormAnswersBody,
  options: { finalize: boolean }
) {
  await assertStudentExists(studentId);
  const template = await resolveTemplateOrThrow(formType, input.cohort, input.version);
  const submittedByRole = FORM_TYPE_TO_ROLE[formType];

  const questionsByFieldKey = new Map(template.questions.map((q) => [q.fieldKey, q]));
  for (const a of input.answers) {
    if (!questionsByFieldKey.has(a.fieldKey)) {
      throw new BadRequestError(`Unknown question fieldKey "${a.fieldKey}" for this form`);
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.formSubmission.findUnique({
      where: {
        studentId_formTemplateId_submittedByRole: {
          studentId,
          formTemplateId: template.id,
          submittedByRole,
        },
      },
    });

    if (existing?.submittedAt) {
      throw new ConflictError("This form has already been submitted and is locked");
    }

    const submission =
      existing ??
      (await tx.formSubmission.create({
        data: { studentId, formTemplateId: template.id, submittedByRole },
      }));

    for (const a of input.answers) {
      const question = questionsByFieldKey.get(a.fieldKey)!;
      await tx.formAnswer.upsert({
        where: {
          submissionId_questionId: { submissionId: submission.id, questionId: question.id },
        },
        update: { answer: a.answer as never },
        create: { submissionId: submission.id, questionId: question.id, answer: a.answer as never },
      });
    }

    if (options.finalize) {
      const allAnswers = await tx.formAnswer.findMany({ where: { submissionId: submission.id } });
      const answeredQuestionIds = new Set(
        allAnswers.filter((a) => !isAnswerEmpty(a.answer)).map((a) => a.questionId)
      );
      const missing = template.questions.filter(
        (q) => q.isRequired && !answeredQuestionIds.has(q.id)
      );
      if (missing.length > 0) {
        throw new BadRequestError("Missing required answers", {
          missingFieldKeys: missing.map((q) => q.fieldKey),
        });
      }

      await tx.formSubmission.update({
        where: { id: submission.id },
        data: { submittedAt: new Date() },
      });
    }
  });

  return getFormSubmission(formType, studentId, input.cohort, input.version);
}

export async function getFormSubmission(
  formType: FormType,
  studentId: string,
  cohort: string,
  version?: number
) {
  const template = await resolveTemplateOrThrow(formType, cohort, version);
  const submittedByRole = FORM_TYPE_TO_ROLE[formType];

  const submission = await prisma.formSubmission.findUnique({
    where: {
      studentId_formTemplateId_submittedByRole: {
        studentId,
        formTemplateId: template.id,
        submittedByRole,
      },
    },
    include: {
      answers: { include: { question: true }, orderBy: { question: { order: "asc" } } },
    },
  });

  if (!submission) {
    throw new NotFoundError("No submission found for this student/form");
  }

  return submission;
}
