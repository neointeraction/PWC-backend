import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { class9to10AssessmentQuestions } from "./seed-data/assessment/class9to10.js";
import { seedCareerLibraryData } from "./seed-data/career-library/index.js";
import { seedCareerLibraryNormalization } from "./seed-data/career-library/normalize.js";
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

// The only way to get a first login — there's no self-register endpoint (see
// src/modules/auth/auth.routes.ts). Idempotent: re-running the seed won't reset the
// password on an existing account, so a password changed after first login sticks.
async function seedSuperAdmin(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: env.SEED_SUPER_ADMIN_EMAIL } });
  if (existing) {
    console.log(`Super Admin already exists (${env.SEED_SUPER_ADMIN_EMAIL}) — leaving as-is`);
    return;
  }

  const passwordHash = await argon2.hash(env.SEED_SUPER_ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      email: env.SEED_SUPER_ADMIN_EMAIL,
      passwordHash,
      role: "SUPER_ADMIN",
      firstName: "Super",
      lastName: "Admin",
      mustChangePassword: true,
    },
  });
  console.log(`Seeded Super Admin login: ${env.SEED_SUPER_ADMIN_EMAIL} / (password from SEED_SUPER_ADMIN_PASSWORD)`);
}

async function seedCohorts(): Promise<void> {
  // Read-only lookup for cohort dropdowns. `code` matches the cohort strings used across
  // the app's cohort-scoped content. Only Class 9-10 exists today.
  await prisma.cohort.upsert({
    where: { code: "CLASS_9_10" },
    update: { name: "Class 9 & 10" },
    create: { code: "CLASS_9_10", name: "Class 9 & 10", displayOrder: 1 },
  });
}

async function main(): Promise<void> {
  await seedSuperAdmin();
  await seedCohorts();
  await seedFormTemplate("PRE_COUNSELLING_STUDENT", preCounsellingStudentQuestions);
  await seedFormTemplate("PRE_COUNSELLING_PARENT", preCounsellingParentQuestions);
  await seedFormTemplate("FEEDBACK_STUDENT", feedbackStudentQuestions);
  await seedFormTemplate("FEEDBACK_PARENT", feedbackParentQuestions);
  await seedAssessmentQuestions(class9to10AssessmentQuestions);
  await seedCareerLibraryData(prisma);
  await seedCareerLibraryNormalization(prisma);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
