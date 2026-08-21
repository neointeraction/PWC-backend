import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { nextCode } from "../src/common/utils/codeSequence.js";
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

async function seedLanguages(): Promise<void> {
  // Read-only lookup for the project-creation language dropdown. English is the default
  // (isDefault: true) and, for now, the only option — more can be added later.
  const english = await prisma.language.upsert({
    where: { code: "en" },
    update: { name: "English", isDefault: true, isActive: true },
    create: { code: "en", name: "English", isDefault: true, displayOrder: 1 },
  });
  // Backfill any pre-language projects to the default so no project is left without one.
  await prisma.project.updateMany({ where: { languageId: null }, data: { languageId: english.id } });
  console.log("Seeded languages: English (default)");
}

// Demo logins so the client can browse each role's UI. Idempotent (skips anything that
// already exists) and non-destructive. Counsellor/Student need a supporting
// institute → class → division → project, created here too. All are seeded with
// mustChangePassword: false so they land straight in the app (no forced reset).
async function seedDemoAccounts(): Promise<void> {
  // --- Admin (a plain User with role ADMIN — no profile table) ---
  const adminEmail = "admin@kreate.local";
  if (!(await prisma.user.findUnique({ where: { email: adminEmail } }))) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash("Admin@123"),
        role: "ADMIN",
        firstName: "Demo",
        lastName: "Admin",
        mustChangePassword: false,
      },
    });
    console.log(`Seeded demo Admin login: ${adminEmail} / Admin@123`);
  }

  // --- Supporting institute → class → division → project ---
  const institute = await prisma.institute.upsert({
    where: { name: "Demo Institute" },
    update: {},
    create: {
      name: "Demo Institute",
      address: "1 Demo Street, Demo City",
      contactNumber: "+919000000001",
      primaryEmail: "demo.institute@kreate.local",
    },
  });

  let demoClass = await prisma.instituteClass.findFirst({
    where: { instituteId: institute.id, name: "Class 10" },
  });
  if (!demoClass) {
    demoClass = await prisma.instituteClass.create({
      data: { name: "Class 10", instituteId: institute.id },
    });
  }

  let division = await prisma.instituteDivision.findFirst({
    where: { classId: demoClass.id, name: "A" },
  });
  if (!division) {
    division = await prisma.instituteDivision.create({
      data: { name: "A", classId: demoClass.id },
    });
  }

  const defaultLanguage = await prisma.language.findFirst({ where: { isDefault: true } });
  let project = await prisma.project.findFirst({
    where: { instituteId: institute.id, name: "Demo Project" },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        // Pull from the shared counter so the demo project's code stays in sequence with
        // API-created ones (no collision with a later P000x).
        code: await nextCode(prisma, "PROJECT"),
        instituteId: institute.id,
        name: "Demo Project",
        fromDate: new Date("2025-01-01"),
        toDate: new Date("2030-12-31"),
        status: "ACTIVE",
        languageId: defaultLanguage?.id,
      },
    });
  }

  // --- Counsellor (User + Counsellor + project assignment) ---
  const counsellorEmail = "counsellor@kreate.local";
  let counsellorUser = await prisma.user.findUnique({ where: { email: counsellorEmail } });
  if (!counsellorUser) {
    counsellorUser = await prisma.user.create({
      data: {
        email: counsellorEmail,
        passwordHash: await argon2.hash("Counsellor@123"),
        role: "COUNSELLOR",
        firstName: "Demo",
        lastName: "Counsellor",
        mustChangePassword: false,
      },
    });
    console.log(`Seeded demo Counsellor login: ${counsellorEmail} / Counsellor@123`);
  }
  let counsellor = await prisma.counsellor.findUnique({ where: { userId: counsellorUser.id } });
  if (!counsellor) {
    counsellor = await prisma.counsellor.create({
      data: {
        userId: counsellorUser.id,
        counsellorCode: "DEMO-CNSL-01",
        instituteId: institute.id,
        mobile: "+919000000002",
      },
    });
  }
  const assigned = await prisma.projectCounsellor.findFirst({
    where: { projectId: project.id, counsellorId: counsellor.id },
  });
  if (!assigned) {
    await prisma.projectCounsellor.create({
      data: { projectId: project.id, counsellorId: counsellor.id },
    });
  }

  // --- Student (User + Student record) ---
  const studentEmail = "student@kreate.local";
  let studentUser = await prisma.user.findUnique({ where: { email: studentEmail } });
  if (!studentUser) {
    studentUser = await prisma.user.create({
      data: {
        email: studentEmail,
        passwordHash: await argon2.hash("Student@123"),
        role: "STUDENT",
        firstName: "Demo",
        lastName: "Student",
        mustChangePassword: false,
      },
    });
    console.log(`Seeded demo Student login: ${studentEmail} / Student@123`);
  }
  if (!(await prisma.student.findUnique({ where: { userId: studentUser.id } }))) {
    await prisma.student.create({
      data: {
        userId: studentUser.id,
        studentCode: "DEMO-STU-01",
        projectId: project.id,
        divisionId: division.id,
        mobile: "+919000000003",
        parentMobile: "+919000000004",
        parentEmail: "demo.parent@kreate.local",
        fatherName: "Demo Father",
        fatherOccupation: "Engineer",
        motherName: "Demo Mother",
        motherOccupation: "Doctor",
      },
    });
  }
}

async function main(): Promise<void> {
  await seedSuperAdmin();
  await seedCohorts();
  await seedLanguages();
  await seedDemoAccounts();
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
