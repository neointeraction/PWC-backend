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

// `createMany({ skipDuplicates })` leaves rows that already exist untouched, so on a re-seed
// of an already-normalized database any detail column added later would stay null forever.
// Fill those blanks explicitly — same rule as the API's inline "add new": fill, never
// overwrite, since a canonical row may have been corrected by hand.
async function fillCanonicalBlanks<T extends { id: string }>(
  rows: T[],
  sourceFor: (row: T) => Record<string, unknown> | undefined,
  update: (id: string, data: Record<string, string>) => Promise<unknown>
): Promise<number> {
  let filled = 0;
  for (const row of rows) {
    const source = sourceFor(row);
    if (!source) continue;
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === "name" || key === "level") continue; // identity, not detail
      const v = clean(value);
      if (v && (row as Record<string, unknown>)[key] == null) patch[key] = v;
    }
    if (Object.keys(patch).length > 0) {
      await update(row.id, patch);
      filled += 1;
    }
  }
  return filled;
}

export async function seedCareerLibraryNormalization(prisma: PrismaClient): Promise<void> {
  const entryRows = await prisma.careerLibraryEntry.findMany({
    select: {
      id: true,
      entranceExams: true,
      entranceExamsPG: true,
      topCourses: true,
      // industry is now normalized — read it through the domain → industry relation.
      domain: { select: { industry: { select: { name: true } } } },
    },
  });
  const entries = entryRows.map((e) => ({
    id: e.id,
    industry: e.domain.industry.name,
    entranceExams: e.entranceExams,
    entranceExamsPG: e.entranceExamsPG,
    topCourses: e.topCourses,
  }));

  // --- 1. Canonical EntranceExam (UG from UgEntranceExam, PG from PgEntranceExam, plus
  //        any names only present on entries' arrays) ---
  const [ugExams, pgExams] = await Promise.all([
    prisma.ugEntranceExam.findMany({
      select: {
        examName: true,
        fullForm: true,
        conductingBody: true,
        officialWebsite: true,
        examMode: true,
        frequency: true,
        applicableFor: true,
        subjectRequirements12th: true,
        applicationWindow: true,
      },
    }),
    prisma.pgEntranceExam.findMany({ select: { examName: true, officialWebsite: true, coursesForExam: true } }),
  ]);

  // Some job roles' raw "Entrance Exams (PG Level)" text names an exam by a spelling/format
  // that doesn't match its PgEntranceExam row verbatim (hyphen vs space, or a whole phrase
  // where only part of it is a real exam name) — verified by hand against the workbook, see
  // docs/db-design.md. Without this, the backfill below would create a second, detail-less
  // canonical row for each variant instead of reusing the one PG Entrance_IND already
  // describes. "CAT/XAT" names two exams in one cell, so it expands to both.
  const PG_EXAM_ALIASES: Record<string, string[]> = {
    "CUET-PG": ["CUET PG"],
    "CUET-PG / University PG Entrances": ["CUET PG"],
    "NEET-PG": ["NEET PG"],
    "CLAT-PG": ["CLAT PG"],
    "AILET-PG": ["AILET PG"],
    "CAT/XAT": ["CAT", "XAT"],
  };
  const expandPgExamNames = (names: string[]): string[] =>
    names.flatMap((n) => PG_EXAM_ALIASES[clean(n)] ?? [n]);

  const examMap = new Map<string, Prisma.EntranceExamCreateManyInput>();
  const addExam = (name: unknown, level: QualificationLevel, extra: Partial<Prisma.EntranceExamCreateManyInput> = {}) => {
    const n = clean(name);
    if (!n) return;
    const key = `${n}||${level}`;
    if (!examMap.has(key)) examMap.set(key, { name: n, level, ...extra });
  };
  for (const e of ugExams) {
    addExam(e.examName, "UG", {
      fullForm: e.fullForm,
      conductingBody: e.conductingBody,
      officialWebsite: e.officialWebsite,
      examMode: e.examMode,
      frequency: e.frequency,
      applicableFor: e.applicableFor,
      subjectRequirements12th: e.subjectRequirements12th,
      applicationWindow: e.applicationWindow,
    });
  }
  // PG Entrance_IND has no conductingBody/examMode/frequency/subjectRequirements12th columns
  // at all — only name, the courses it's for, and a website — so `applicableFor` (fed from
  // "Courses for which the exam is meant") is the only detail a PG exam can ever carry.
  for (const e of pgExams) addExam(e.examName, "PG", { officialWebsite: e.officialWebsite, applicableFor: e.coursesForExam });
  for (const e of entries) {
    for (const n of e.entranceExams) addExam(n, "UG");
    for (const n of expandPgExamNames(e.entranceExamsPG)) addExam(n, "PG");
  }
  await createManyBatched((a) => prisma.entranceExam.createMany(a), [...examMap.values()]);
  await fillCanonicalBlanks(
    await prisma.entranceExam.findMany(),
    (r) => examMap.get(`${r.name}||${r.level}`),
    (id, data) => prisma.entranceExam.update({ where: { id }, data })
  );

  // --- 2. Canonical Institution (union of all directory institution names, deduped) ---
  const [ugInst, ugUniv, pgInst] = await Promise.all([
    prisma.ugInstitution.findMany({
      select: {
        name: true, city: true, state: true, type: true, website: true,
        shortName: true, programmesOffered: true, primaryEntranceExams: true, nirfRanking: true,
      },
    }),
    prisma.ugInstitutionUniversity.findMany({
      select: {
        name: true, city: true, state: true, type: true, website: true,
        shortName: true, keyProgrammesOffered: true, primaryEntranceExams: true, nirfRanking: true,
      },
    }),
    prisma.pgInstitution.findMany({ select: { institution: true, city: true, state: true } }),
  ]);
  const instMap = new Map<string, Prisma.InstitutionCreateManyInput>();
  const addInst = (name: unknown, extra: Partial<Prisma.InstitutionCreateManyInput> = {}) => {
    const n = clean(name);
    if (!n) return;
    if (!instMap.has(n)) instMap.set(n, { name: n, ...extra });
  };
  for (const i of ugInst) {
    addInst(i.name, {
      city: i.city, state: i.state, type: i.type, website: i.website,
      shortName: i.shortName,
      programmesOffered: i.programmesOffered,
      entranceExamsRequired: i.primaryEntranceExams,
      ranking: i.nirfRanking,
    });
  }
  for (const i of ugUniv) {
    addInst(i.name, {
      city: i.city, state: i.state, type: i.type, website: i.website,
      shortName: i.shortName,
      programmesOffered: i.keyProgrammesOffered,
      entranceExamsRequired: i.primaryEntranceExams,
      ranking: i.nirfRanking,
    });
  }
  for (const i of pgInst) addInst(i.institution, { city: i.city, state: i.state });
  await createManyBatched((a) => prisma.institution.createMany(a), [...instMap.values()]);
  await fillCanonicalBlanks(
    await prisma.institution.findMany(),
    (r) => instMap.get(r.name),
    (id, data) => prisma.institution.update({ where: { id }, data })
  );

  // --- 3. Canonical Course (all UG — the source is the "UG Courses" tab + entries' topCourses) ---
  const ugCourses = await prisma.ugCourse.findMany({
    select: {
      courseName: true,
      fullForm: true,
      durationYears: true,
      stream12thRequirements: true,
      entranceExamsPrimary: true,
      entranceExamsAlternate: true,
      topSpecialisations: true,
      topGovtColleges: true,
      topPrivateColleges: true,
      furtherStudyOptions: true,
    },
  });
  const courseMap = new Map<string, Prisma.CourseCreateManyInput>();
  const addCourse = (name: unknown, extra: Partial<Prisma.CourseCreateManyInput> = {}) => {
    const n = clean(name);
    if (!n) return;
    const key = `${n}||UG`;
    if (!courseMap.has(key)) courseMap.set(key, { name: n, level: "UG", ...extra });
  };
  for (const c of ugCourses) {
    // The source splits top colleges into govt/private columns; the canonical row keeps one list.
    const topColleges = [c.topGovtColleges, c.topPrivateColleges].map(clean).filter(Boolean).join("; ") || null;
    // Same for primary/alternate entrance exams — "No alternative" is a placeholder, not data.
    const relevantEntranceExams =
      [c.entranceExamsPrimary, clean(c.entranceExamsAlternate).toLowerCase() === "no alternative" ? "" : c.entranceExamsAlternate]
        .map(clean)
        .filter(Boolean)
        .join("; ") || null;
    addCourse(c.courseName, {
      fullForm: c.fullForm,
      durationYears: c.durationYears,
      stream12thRequirements: c.stream12thRequirements,
      relevantEntranceExams,
      programmesOffered: c.topSpecialisations,
      topColleges,
      furtherStudyOptions: c.furtherStudyOptions,
    });
  }
  for (const e of entries) for (const n of e.topCourses) addCourse(n);
  await createManyBatched((a) => prisma.course.createMany(a), [...courseMap.values()]);
  await fillCanonicalBlanks(
    await prisma.course.findMany(),
    (r) => courseMap.get(`${r.name}||${r.level}`),
    (id, data) => prisma.course.update({ where: { id }, data })
  );

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
    for (const n of expandPgExamNames(e.entranceExamsPG)) {
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
