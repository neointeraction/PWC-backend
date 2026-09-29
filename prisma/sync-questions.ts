import { PrismaClient } from "@prisma/client";
import { class9to10AssessmentQuestions } from "./seed-data/assessment/class9to10.js";
import { feedbackParentQuestions } from "./seed-data/forms/feedbackParent.js";
import { feedbackStudentQuestions } from "./seed-data/forms/feedbackStudent.js";
import { preCounsellingParentQuestions } from "./seed-data/forms/preCounsellingParent.js";
import { preCounsellingStudentQuestions } from "./seed-data/forms/preCounsellingStudent.js";
import type { FormQuestionSeed } from "./seed-data/types.js";
import { COHORT, seedAssessmentQuestions, seedFormTemplate, type SeedFormType } from "./seed-questions.js";

// Question-only sync: pushes the form + assessment question seed files into a database
// (e.g. live) WITHOUT the rest of `db:seed` — in particular without the career library
// import, which deletes and reinserts that whole library.
//
//   pnpm db:sync:questions            → dry run: lists what would change, writes nothing
//   pnpm db:sync:questions --apply    → writes the changes
//
// Targets whatever DATABASE_URL points at, so for live:
//   DATABASE_URL="<live url>" pnpm db:sync:questions --apply

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const FORMS: [SeedFormType, FormQuestionSeed[]][] = [
  ["PRE_COUNSELLING_STUDENT", preCounsellingStudentQuestions],
  ["PRE_COUNSELLING_PARENT", preCounsellingParentQuestions],
  ["FEEDBACK_STUDENT", feedbackStudentQuestions],
  ["FEEDBACK_PARENT", feedbackParentQuestions],
];

// Same fields the seeders write, normalised the way they write them, so an unchanged
// question compares equal.
const formFields = (q: FormQuestionSeed | Record<string, unknown>) => ({
  order: q.order,
  questionCode: q.questionCode,
  sectionLabel: q.sectionLabel ?? null,
  questionText: q.questionText,
  helpText: q.helpText ?? null,
  questionType: q.questionType,
  options: q.options ?? null,
  allowOtherText: q.allowOtherText ?? false,
  otherTextFieldKey: q.otherTextFieldKey ?? null,
  isRequired: q.isRequired ?? true,
});

// Postgres jsonb doesn't keep object key order, so compare with keys sorted — otherwise
// every stored `options` blob looks "changed". `undefined` properties are dropped, the
// same way they are when written to jsonb.
const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)])
    );
  }
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.keys(after).filter(k => !same(before[k], after[k]));

function describeTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}:${url.port || 5432}${url.pathname}`;
  } catch {
    return "(DATABASE_URL not set or unreadable)";
  }
}

async function main(): Promise<void> {
  console.log(`Target database: ${describeTarget()}`);
  console.log(apply ? "Mode: APPLY (writing changes)\n" : "Mode: DRY RUN (nothing is written — add --apply to write)\n");

  let total = 0;

  for (const [formType, questions] of FORMS) {
    const template = await prisma.formTemplate.findUnique({
      where: { formType_cohort_version: { formType, cohort: COHORT, version: 1 } },
      include: { questions: true },
    });
    const existing = new Map((template?.questions ?? []).map(q => [q.fieldKey, q]));
    for (const q of questions) {
      const row = existing.get(q.fieldKey);
      if (!row) {
        console.log(`  ${formType} ${q.questionCode} (${q.fieldKey}): NEW question`);
        total++;
        continue;
      }
      const fields = changedFields(formFields(row as never), formFields(q));
      if (fields.length) {
        console.log(`  ${formType} ${q.questionCode} (${q.fieldKey}): ${fields.join(", ")}`);
        total++;
      }
    }
    if (apply) await seedFormTemplate(prisma, formType, questions);
  }

  const existingAssessment = new Map(
    (await prisma.assessmentQuestion.findMany({ where: { cohort: COHORT } })).map(q => [q.fieldKey, q])
  );
  for (const q of class9to10AssessmentQuestions) {
    const row = existingAssessment.get(q.fieldKey);
    if (!row) {
      console.log(`  ASSESSMENT ${q.questionCode} (${q.fieldKey}): NEW question`);
      total++;
      continue;
    }
    const after = { questionText: q.questionText, options: q.options ?? null, correctOption: q.correctOption ?? null };
    const before = { questionText: row.questionText, options: row.options ?? null, correctOption: row.correctOption ?? null };
    const fields = changedFields(before, after);
    if (fields.length) {
      console.log(`  ASSESSMENT ${q.questionCode} (${q.fieldKey}): ${fields.join(", ")}`);
      total++;
    }
  }
  if (apply) await seedAssessmentQuestions(prisma, class9to10AssessmentQuestions);

  console.log(
    `\n${total} question(s) ${apply ? "updated" : "would change"}.` +
      (!apply && total ? " Re-run with --apply to write them." : "")
  );
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
