import type { PrismaClient } from "@prisma/client";
import type { AssessmentQuestionSeed, FormQuestionSeed } from "./seed-data/types.js";

// Question seeders shared by the full seed (seed.ts) and the question-only sync
// (sync-questions.ts). Both upsert by fieldKey, so re-running updates text/options in
// place without touching saved answers.

export const COHORT = "CLASS_9_10";

export type SeedFormType = "PRE_COUNSELLING_STUDENT" | "PRE_COUNSELLING_PARENT" | "FEEDBACK_STUDENT" | "FEEDBACK_PARENT";

export async function seedFormTemplate(
  prisma: PrismaClient,
  formType: SeedFormType,
  questions: FormQuestionSeed[]
): Promise<void> {
  const template = await prisma.formTemplate.upsert({
    where: { formType_cohort_version: { formType, cohort: COHORT, version: 1 } },
    update: {},
    create: { formType, cohort: COHORT, version: 1 },
  });

  for (const q of questions) {
    await prisma.formQuestion.upsert({
      where: { formTemplateId_fieldKey: { formTemplateId: template.id, fieldKey: q.fieldKey } },
      update: {
        order: q.order,
        questionCode: q.questionCode,
        sectionLabel: q.sectionLabel,
        questionText: q.questionText,
        helpText: q.helpText,
        questionType: q.questionType,
        options: q.options as never,
        allowOtherText: q.allowOtherText ?? false,
        otherTextFieldKey: q.otherTextFieldKey,
        isRequired: q.isRequired ?? true,
      },
      create: {
        formTemplateId: template.id,
        order: q.order,
        questionCode: q.questionCode,
        fieldKey: q.fieldKey,
        sectionLabel: q.sectionLabel,
        questionText: q.questionText,
        helpText: q.helpText,
        questionType: q.questionType,
        options: q.options as never,
        allowOtherText: q.allowOtherText ?? false,
        otherTextFieldKey: q.otherTextFieldKey,
        isRequired: q.isRequired ?? true,
      },
    });
  }

  console.log(`Seeded ${questions.length} questions for ${formType} (cohort ${COHORT})`);
}

export async function seedAssessmentQuestions(
  prisma: PrismaClient,
  questions: AssessmentQuestionSeed[]
): Promise<void> {
  for (const q of questions) {
    await prisma.assessmentQuestion.upsert({
      where: { cohort_fieldKey: { cohort: COHORT, fieldKey: q.fieldKey } },
      update: {
        section: q.section,
        order: q.order,
        displayOrder: q.displayOrder,
        questionCode: q.questionCode,
        questionText: q.questionText,
        format: q.format,
        options: q.options as never,
        trait: q.trait,
        traitCode: q.traitCode,
        difficulty: q.difficulty,
        weight: q.weight ?? 1,
        correctOption: q.correctOption,
      },
      create: {
        cohort: COHORT,
        section: q.section,
        order: q.order,
        displayOrder: q.displayOrder,
        questionCode: q.questionCode,
        fieldKey: q.fieldKey,
        questionText: q.questionText,
        format: q.format,
        options: q.options as never,
        trait: q.trait,
        traitCode: q.traitCode,
        difficulty: q.difficulty,
        weight: q.weight ?? 1,
        correctOption: q.correctOption,
      },
    });
  }

  console.log(`Seeded ${questions.length} assessment questions (cohort ${COHORT})`);
}
