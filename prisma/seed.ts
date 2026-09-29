import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { class9to10AssessmentQuestions } from "./seed-data/assessment/class9to10.js";
import { seedCareerLibraryData } from "./seed-data/career-library/index.js";
import { seedCareerLibraryNormalization } from "./seed-data/career-library/normalize.js";
import { seedEducationPath } from "./seed-education-path.js";
import { seedScoringReferenceData } from "./seed-scoring.js";
import { feedbackParentQuestions } from "./seed-data/forms/feedbackParent.js";
import { feedbackStudentQuestions } from "./seed-data/forms/feedbackStudent.js";
import { preCounsellingParentQuestions } from "./seed-data/forms/preCounsellingParent.js";
import { preCounsellingStudentQuestions } from "./seed-data/forms/preCounsellingStudent.js";
import { seedAssessmentQuestions, seedFormTemplate } from "./seed-questions.js";

const prisma = new PrismaClient();

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

async function main(): Promise<void> {
  await seedSuperAdmin();
  await seedCohorts();
  await seedLanguages();
  await seedFormTemplate(prisma, "PRE_COUNSELLING_STUDENT", preCounsellingStudentQuestions);
  await seedFormTemplate(prisma, "PRE_COUNSELLING_PARENT", preCounsellingParentQuestions);
  await seedFormTemplate(prisma, "FEEDBACK_STUDENT", feedbackStudentQuestions);
  await seedFormTemplate(prisma, "FEEDBACK_PARENT", feedbackParentQuestions);
  await seedAssessmentQuestions(prisma, class9to10AssessmentQuestions);
  await seedScoringReferenceData();
  await seedCareerLibraryData(prisma);
  await seedCareerLibraryNormalization(prisma);
  // Derives EducationEntry + role links from the flat qualification*/certifications*
  // columns the workbook import leaves behind. Must run after the two above, since it
  // reads the career entries they create.
  await seedEducationPath();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
