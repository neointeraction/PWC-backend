import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { advanceWorkflowStatus } from "../../common/workflow/workflowStatus.js";
import { assertStudentProjectWindowOpen } from "../../common/utils/projectWindow.js";
import type { FormTypeParams, GetFormTemplateQuery, SaveFormAnswersBody } from "./forms.schema.js";

type FormType = FormTypeParams["formType"];
type SubmittedByRole = "STUDENT" | "PARENT";

// Every form type is filled by exactly one role — see docs/db-design.md. (The student
// profile isn't a forms-API form; it's captured at POST /students.)
const FORM_TYPE_TO_ROLE: Record<FormType, SubmittedByRole> = {
  PRE_COUNSELLING_STUDENT: "STUDENT",
  FEEDBACK_STUDENT: "STUDENT",
  PRE_COUNSELLING_PARENT: "PARENT",
  FEEDBACK_PARENT: "PARENT",
};

// The two halves of the pre-counselling pair — once both are submitted for a student,
// the workflow can advance. Maps each side to the other.
const PRE_COUNSELLING_COUNTERPART: Partial<Record<FormType, FormType>> = {
  PRE_COUNSELLING_STUDENT: "PRE_COUNSELLING_PARENT",
  PRE_COUNSELLING_PARENT: "PRE_COUNSELLING_STUDENT",
};

async function isFormSubmitted(
  tx: Prisma.TransactionClient,
  studentId: string,
  formType: FormType,
  cohort: string
): Promise<boolean> {
  const template = await tx.formTemplate.findFirst({
    where: { formType, cohort, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!template) return false;

  const submission = await tx.formSubmission.findUnique({
    where: {
      studentId_formTemplateId_submittedByRole: {
        studentId,
        formTemplateId: template.id,
        submittedByRole: FORM_TYPE_TO_ROLE[formType],
      },
    },
  });
  return Boolean(submission?.submittedAt);
}

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
  // No login on this flow — the project window is the gate: reject drafts and submits
  // once the student's project has ended (or been closed). Also 404s an unknown student.
  await assertStudentProjectWindowOpen(studentId);
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

      const counterpartFormType = PRE_COUNSELLING_COUNTERPART[formType];
      if (counterpartFormType && (await isFormSubmitted(tx, studentId, counterpartFormType, input.cohort))) {
        await advanceWorkflowStatus(tx, studentId, "PRE_COUNSELLING_FORMS_SUBMITTED");
      }
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

// Per-form submission flags for a student — drives reminder/link logic (e.g. "has the
// parent submitted their pre-counselling and feedback forms yet?"). A form counts as
// submitted only once finalized (`submittedAt` set), not while it's a saved draft.
export async function getFormStatus(studentId: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    throw new NotFoundError("Student not found");
  }

  const submissions = await prisma.formSubmission.findMany({
    where: { studentId, submittedAt: { not: null } },
    select: { submittedAt: true, formTemplate: { select: { formType: true } } },
  });

  const statusFor = (formType: FormType): { submitted: boolean; submittedAt: Date | null } => {
    const matches = submissions.filter((s) => s.formTemplate.formType === formType);
    const latest = matches.reduce<Date | null>(
      (acc, s) => (s.submittedAt && (!acc || s.submittedAt > acc) ? s.submittedAt : acc),
      null
    );
    return { submitted: matches.length > 0, submittedAt: latest };
  };

  const forms = {
    preCounsellingStudent: statusFor("PRE_COUNSELLING_STUDENT"),
    preCounsellingParent: statusFor("PRE_COUNSELLING_PARENT"),
    feedbackStudent: statusFor("FEEDBACK_STUDENT"),
    feedbackParent: statusFor("FEEDBACK_PARENT"),
  };

  return {
    studentId,
    forms,
    preCounsellingComplete:
      forms.preCounsellingStudent.submitted && forms.preCounsellingParent.submitted,
    feedbackComplete: forms.feedbackStudent.submitted && forms.feedbackParent.submitted,
  };
}
