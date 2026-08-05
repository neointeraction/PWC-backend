import { PrismaClient } from "@prisma/client";
import { class9to10AssessmentQuestions } from "./seed-data/assessment/class9to10.js";
import { feedbackParentQuestions } from "./seed-data/forms/feedbackParent.js";
import { feedbackStudentQuestions } from "./seed-data/forms/feedbackStudent.js";
import { preCounsellingParentQuestions } from "./seed-data/forms/preCounsellingParent.js";
import { preCounsellingStudentQuestions } from "./seed-data/forms/preCounsellingStudent.js";
import type { AssessmentQuestionSeed, FormQuestionSeed } from "./seed-data/types.js";

const prisma = new PrismaClient();

const COHORT = "CLASS_9_10";

async function seedFormTemplate(
  formType: "PRE_COUNSELLING_STUDENT" | "PRE_COUNSELLING_PARENT" | "FEEDBACK_STUDENT" | "FEEDBACK_PARENT",
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

async function seedAssessmentQuestions(questions: AssessmentQuestionSeed[]): Promise<void> {
  for (const q of questions) {
    await prisma.assessmentQuestion.upsert({
      where: { cohort_fieldKey: { cohort: COHORT, fieldKey: q.fieldKey } },
      update: {
        section: q.section,
        order: q.order,
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

async function main(): Promise<void> {
  await seedFormTemplate("PRE_COUNSELLING_STUDENT", preCounsellingStudentQuestions);
  await seedFormTemplate("PRE_COUNSELLING_PARENT", preCounsellingParentQuestions);
  await seedFormTemplate("FEEDBACK_STUDENT", feedbackStudentQuestions);
  await seedFormTemplate("FEEDBACK_PARENT", feedbackParentQuestions);
  await seedAssessmentQuestions(class9to10AssessmentQuestions);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
