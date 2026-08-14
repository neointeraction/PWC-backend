import type { Prisma, PrismaClient, QualificationLevel } from "@prisma/client";

// Backfills the normalized career-library lookups + join tables from the imported
// directories and the existing entries' array columns. Idempotent: canonical rows use
// `skipDuplicates` on their unique keys, and join rows on their composite PKs, so it's
// safe to re-run. Must run AFTER seedCareerLibraryData (which replaces entries + the
// Ug*/Pg* directories). See docs/career-library-normalization-spec.md.

const clean = (s: unknown): string => (typeof s === "string" ? s.trim() : "");

async function createManyBatched<T>(
  create: (args: { data: T[]; skipDuplicates: boolean }) => Promise<unknown>,
  rows: T[],
  size = 5000
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await create({ data: rows.slice(i, i + size), skipDuplicates: true });
  }
}

export async function seedCareerLibraryNormalization(prisma: PrismaClient): Promise<void> {
  const entries = await prisma.careerLibraryEntry.findMany({
    select: { id: true, industry: true, entranceExams: true, entranceExamsPG: true, topCourses: true },
  });

  // --- 1. Canonical EntranceExam (UG from UgEntranceExam, PG from PgEntranceExam, plus
  //        any names only present on entries' arrays) ---
  const [ugExams, pgExams] = await Promise.all([
    prisma.ugEntranceExam.findMany({ select: { examName: true, fullForm: true, conductingBody: true, officialWebsite: true } }),
    prisma.pgEntranceExam.findMany({ select: { examName: true, officialWebsite: true } }),
  ]);
  const examMap = new Map<string, Prisma.EntranceExamCreateManyInput>();
  const addExam = (name: unknown, level: QualificationLevel, extra: Partial<Prisma.EntranceExamCreateManyInput> = {}) => {
    const n = clean(name);
    if (!n) return;
    const key = `${n}||${level}`;
    if (!examMap.has(key)) examMap.set(key, { name: n, level, ...extra });
  };
  for (const e of ugExams) addExam(e.examName, "UG", { fullForm: e.fullForm, conductingBody: e.conductingBody, officialWebsite: e.officialWebsite });
  for (const e of pgExams) addExam(e.examName, "PG", { officialWebsite: e.officialWebsite });
  for (const e of entries) {
    for (const n of e.entranceExams) addExam(n, "UG");
    for (const n of e.entranceExamsPG) addExam(n, "PG");
  }
  await createManyBatched((a) => prisma.entranceExam.createMany(a), [...examMap.values()]);

  // --- 2. Canonical Institution (union of all directory institution names, deduped) ---
  const [ugInst, ugUniv, pgInst] = await Promise.all([
    prisma.ugInstitution.findMany({ select: { name: true, city: true, state: true, type: true, website: true } }),
    prisma.ugInstitutionUniversity.findMany({ select: { name: true, city: true, state: true, type: true, website: true } }),
    prisma.pgInstitution.findMany({ select: { institution: true, city: true, state: true } }),
  ]);
  const instMap = new Map<string, Prisma.InstitutionCreateManyInput>();
  const addInst = (name: unknown, extra: Partial<Prisma.InstitutionCreateManyInput> = {}) => {
    const n = clean(name);
    if (!n) return;
    if (!instMap.has(n)) instMap.set(n, { name: n, ...extra });
  };
  for (const i of ugInst) addInst(i.name, { city: i.city, state: i.state, type: i.type, website: i.website });
  for (const i of ugUniv) addInst(i.name, { city: i.city, state: i.state, type: i.type, website: i.website });
  for (const i of pgInst) addInst(i.institution, { city: i.city, state: i.state });
  await createManyBatched((a) => prisma.institution.createMany(a), [...instMap.values()]);

  // --- 3. Canonical Course (all UG — the source is the "UG Courses" tab + entries' topCourses) ---
  const ugCourses = await prisma.ugCourse.findMany({ select: { courseName: true, fullForm: true, durationYears: true } });
  const courseMap = new Map<string, Prisma.CourseCreateManyInput>();
  const addCourse = (name: unknown, extra: Partial<Prisma.CourseCreateManyInput> = {}) => {
    const n = clean(name);
    if (!n) return;
    const key = `${n}||UG`;
    if (!courseMap.has(key)) courseMap.set(key, { name: n, level: "UG", ...extra });
  };
  for (const c of ugCourses) addCourse(c.courseName, { fullForm: c.fullForm, durationYears: c.durationYears });
  for (const e of entries) for (const n of e.topCourses) addCourse(n);
  await createManyBatched((a) => prisma.course.createMany(a), [...courseMap.values()]);

  // --- Load canonical id maps ---
  const [examRows, instRows, courseRows, ugInstByIndustry] = await Promise.all([
    prisma.entranceExam.findMany({ select: { id: true, name: true, level: true } }),
    prisma.institution.findMany({ select: { id: true, name: true } }),
    prisma.course.findMany({ select: { id: true, name: true, level: true } }),
    prisma.ugInstitution.findMany({ select: { industry: true, name: true } }),
  ]);
  const examId = new Map(examRows.map((r) => [`${r.name}||${r.level}`, r.id]));
  const instId = new Map(instRows.map((r) => [r.name, r.id]));
  const courseId = new Map(courseRows.map((r) => [`${r.name}||${r.level}`, r.id]));

  // industry -> set of institution names (for the college backfill via industry match)
  const industryInst = new Map<string, Set<string>>();
  for (const i of ugInstByIndustry) {
    const ind = clean(i.industry);
    const nm = clean(i.name);
    if (!ind || !nm) continue;
    if (!industryInst.has(ind)) industryInst.set(ind, new Set());
    industryInst.get(ind)!.add(nm);
  }

  // --- Backfill join rows ---
  const examJoins: Prisma.CareerEntranceExamCreateManyInput[] = [];
  const courseJoins: Prisma.CareerCourseCreateManyInput[] = [];
  const instJoins: Prisma.CareerInstitutionCreateManyInput[] = [];
  for (const e of entries) {
    for (const n of e.entranceExams) {
      const id = examId.get(`${clean(n)}||UG`);
      if (id) examJoins.push({ careerEntryId: e.id, entranceExamId: id });
    }
    for (const n of e.entranceExamsPG) {
      const id = examId.get(`${clean(n)}||PG`);
      if (id) examJoins.push({ careerEntryId: e.id, entranceExamId: id });
    }
    for (const n of e.topCourses) {
      const id = courseId.get(`${clean(n)}||UG`);
      if (id) courseJoins.push({ careerEntryId: e.id, courseId: id });
    }
    const names = industryInst.get(clean(e.industry));
    if (names) for (const nm of names) {
      const id = instId.get(nm);
      if (id) instJoins.push({ careerEntryId: e.id, institutionId: id });
    }
  }

  await createManyBatched((a) => prisma.careerEntranceExam.createMany(a), examJoins);
  await createManyBatched((a) => prisma.careerCourse.createMany(a), courseJoins);
  await createManyBatched((a) => prisma.careerInstitution.createMany(a), instJoins);
}
