// Derives the normalized Education Path (EducationEntry + CareerEducationEntry) from the
// flat qualification*/certifications* columns the career-library workbook import left on
// CareerLibraryEntry.
//
// Run:  pnpm db:seed:education            (apply)
//       pnpm db:seed:education --dry-run  (report only, writes nothing)
//
// Idempotent: entries are matched on (level, programme) among live rows and links are
// upserted, so re-running adds only what's missing. It never edits or deletes the flat
// columns - those stay as the workbook's descriptive prose (see docs/db-design.md).
//
// WHAT IS AND ISN'T DERIVABLE. The five levels come from different source columns, and
// they are not equally clean:
//
//   CLASS_10_PLUS_2       <- qualification10th12th, taken VERBATIM. Prose ("12th PCM from
//                            a recognized board"), but a small controlled vocabulary that
//                            dedupes to ~26 rows across the whole library, so each one is
//                            a real, reusable entry rather than free text.
//   GRADUATE              <- qualificationGraduation, split on "/" and ",". A genuine
//                            degree list ("BTech / BSc / BCA / Statistics").
//   POST_GRADUATE         <- qualificationPG, split on ",". Same shape as GRADUATE, one
//                            level up.
//   CERTIFICATION_STUDENT <- certificationsStudent[] (already a list)
//   CERTIFICATION_UG      <- certificationsUG[] (already a list)
//
// The workbook's source columns (scripts/export-career-library.py's split_qualification())
// already separate each combined "<degree list>, Focus Electives: <electives>" cell into
// the plain qualificationGraduation/qualificationPG (degree list) and the paired
// qualificationGraduationDefined/qualificationPGDefined (electives) columns — so no marker
// splitting is needed here, unlike the older 1808-workbook import.
//
// DESCRIPTIONS come from the matching explanation column for the level:
//   CLASS_10_PLUS_2 <- qualification10th12thExplanation
//   GRADUATE        <- qualificationGraduationDefined (the electives half, e.g. "Focus
//                       Electives: CS/IT/Maths/Statistics")
//   POST_GRADUATE   <- qualificationPGDefined (same, PG level)
// The certification levels have no explanation column, so those entries carry none. A
// programme is shared by many roles whose explanation text differs, so the first
// non-empty one wins and the rest are reported as conflicts by --dry-run.
//
// The workbook also carries a little junk - a few rows have month names where a
// qualification should be - which JUNK filters out.

import type { EducationPathLevel } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";

const JUNK =
  /^(january|february|march|april|may|june|july|august|september|october|november|december|n\/?a|none|nil|-+)$/i;

// A hedge the workbook appends to most degree names ("BSc Food Science (or a closely
// related field)"). It qualifies the requirement, it isn't part of the programme's name,
// and leaving it on would fragment the vocabulary - so it's stripped.
const HEDGE = /\s*\(?\s*or (?:an? )?(?:closely )?(?:related|equivalent)[^)]*\)?\s*$/i;

// Trim, collapse whitespace, drop trailing punctuation left by sentence-shaped source text.
function clean(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(HEDGE, "")
    .replace(/[.;,]+$/, "")
    .trim();
}

function usable(value: string): boolean {
  // One-character fragments are always parse debris, never a programme name.
  return value.length > 1 && !JUNK.test(value);
}

// Split on separators at paren depth 0 only. "M.Arch (Urban Design, Landscape)" is ONE
// programme with a parenthesised specialisation list; a naive split shreds it into
// "M.Arch (Urban Design" + "Landscape)".
function splitTopLevel(value: string, separators: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && separators.test(ch)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// Degree abbreviations that are meaningless as a *standalone* programme name - "BA" alone
// says nothing about the subject, so when the workbook writes "BA / BSc Economics" it means
// both are Economics degrees, not that plain "BA" (any subject) is also acceptable.
const DEGREE_ABBR =
  "(?:B\\.?A|B\\.?Sc|B\\.?Com|B\\.?Tech|B\\.?E(?!d)|B\\.?BA|B\\.?Arch|B\\.?Des|B\\.?Pharm|B\\.?VSc|LL\\.?B|BCA|" +
  "M\\.?A|M\\.?Sc|M\\.?Com|M\\.?Tech|M\\.?E(?!d)|M\\.?BA|M\\.?Arch|MCA|PGDM)";
const BARE_ABBR = new RegExp(`^${DEGREE_ABBR}\\.?$`, "i");
const ABBR_PREFIX = new RegExp(`^(${DEGREE_ABBR}\\.?)\\s*(.*)$`, "i");

// "BA / BSc Economics" -> "BA Economics / BSc Economics": a shared trailing subject after
// the LAST "/"-alternative is propagated back onto any EARLIER alternative that is itself
// just a bare abbreviation, so every alternative ends up naming the same subject instead of
// splitting into a subject-less "BA" that then collides (in the shared EducationEntry table)
// with every other role's unrelated "BA" mention. Leaves genuine independent-alternative
// lists alone (e.g. "BTech / BSc / BCA / Statistics / Maths", where the last item isn't a
// degree abbreviation at all, so there's no shared subject to propagate).
export function expandSharedSuffix(raw: string): string {
  const groups = splitTopLevel(raw, /\//)
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length < 2) return raw;
  const last = groups[groups.length - 1] ?? "";
  const earlier = groups.slice(0, -1);
  if (!earlier.every((g) => BARE_ABBR.test(g))) return raw;

  const m = last.match(ABBR_PREFIX);
  const extra = (m?.[2] ?? "").trim();
  let suffix: string;
  if (m && extra) {
    // Last alternative is "<ABBR> <extra text>" - propagate just the extra text, e.g.
    // "BSc Economics" -> "Economics".
    suffix = splitTopLevel(extra, /,/)[0]?.trim() ?? "";
  } else if (!m) {
    // Last alternative has no degree-abbreviation prefix at all (e.g. "Economics" in
    // "BCom / BBA / Economics") - the whole thing (up to the first top-level comma) is
    // the shared subject.
    suffix = splitTopLevel(last, /,/)[0]?.trim() ?? "";
  } else {
    return raw; // Last alternative is itself bare - nothing to propagate.
  }
  if (!suffix) return raw;

  return [...earlier.map((g) => `${g} ${suffix}`), last].join(" / ");
}

export function graduationProgrammes(value: string | null): string[] {
  // clean() would strip the hedge before the split, so work off the raw text here and
  // clean each part afterwards. The source column is already just the degree list (the
  // "Focus Electives:" half was split off at export time), so no marker-stripping needed.
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  if (!raw || JUNK.test(raw)) return [];
  return splitTopLevel(expandSharedSuffix(raw), /[/,]/).map(clean).filter(usable);
}

export function postGraduateProgrammes(value: string | null): string[] {
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  if (!raw || JUNK.test(raw)) return [];
  return splitTopLevel(expandSharedSuffix(raw), /[/,]/).map(clean).filter(usable);
}

interface Derived {
  level: EducationPathLevel;
  programme: string;
  description: string | null;
}

export function deriveForEntry(entry: {
  qualification10th12th: string | null;
  qualification10th12thExplanation?: string | null;
  qualificationGraduation: string | null;
  qualificationGraduationDefined: string | null;
  qualificationPG: string | null;
  qualificationPGDefined?: string | null;
  certificationsStudent: string[];
  certificationsUG: string[];
}): Derived[] {
  const out: Derived[] = [];
  const push = (level: EducationPathLevel, programme: string | null | undefined, description: string | null) => {
    const p = clean(programme);
    if (usable(p)) out.push({ level, programme: p, description });
  };

  // Descriptions keep their source punctuation — they're prose, not names, so clean()'s
  // trailing-punctuation trim would be wrong here.
  const describe = (value: string | null | undefined): string | null => {
    const v = (value ?? "").trim().replace(/\s+/g, " ");
    return v && !JUNK.test(v) ? v : null;
  };
  const class1012Description = describe(entry.qualification10th12thExplanation);
  const graduateDescription = describe(entry.qualificationGraduationDefined);
  const postGraduateDescription = describe(entry.qualificationPGDefined);

  push("CLASS_10_PLUS_2", entry.qualification10th12th, class1012Description);
  for (const p of graduationProgrammes(entry.qualificationGraduation)) {
    push("GRADUATE", p, graduateDescription);
  }
  for (const p of postGraduateProgrammes(entry.qualificationPG)) {
    push("POST_GRADUATE", p, postGraduateDescription);
  }
  for (const c of entry.certificationsStudent) push("CERTIFICATION_STUDENT", c, null);
  for (const c of entry.certificationsUG) push("CERTIFICATION_UG", c, null);

  // One role can name the same programme twice (e.g. duplicated certs) - dedupe per role
  // so the link insert isn't asked for the same pair twice.
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = `${d.level} ${d.programme}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function seedEducationPath({ dryRun = false } = {}) {
  const entries = await prisma.careerLibraryEntry.findMany({
    select: {
      id: true,
      jobRole: true,
      qualification10th12th: true,
      qualification10th12thExplanation: true,
      qualificationGraduation: true,
      qualificationGraduationDefined: true,
      qualificationPG: true,
      qualificationPGDefined: true,
      certificationsStudent: true,
      certificationsUG: true,
    },
  });

  // level -> programme -> job role ids that reference it
  interface Wanted {
    level: EducationPathLevel;
    programme: string;
    description: string | null;
    careerIds: string[];
  }
  const wanted = new Map<string, Wanted>();
  let rolesWithNothing = 0;
  // Same programme, different explanation text on another role. First non-empty wins.
  let descriptionConflicts = 0;

  for (const entry of entries) {
    const derived = deriveForEntry(entry);
    if (derived.length === 0) rolesWithNothing++;
    for (const d of derived) {
      const key = `${d.level} ${d.programme}`;
      const bucket = wanted.get(key) ?? {
        level: d.level,
        programme: d.programme,
        description: null,
        careerIds: [],
      };
      if (bucket.description == null) bucket.description = d.description;
      else if (d.description != null && d.description !== bucket.description) descriptionConflicts++;
      bucket.careerIds.push(entry.id);
      wanted.set(key, bucket);
    }
  }

  const totalLinks = [...wanted.values()].reduce((n, w) => n + w.careerIds.length, 0);
  const LEVELS: EducationPathLevel[] = [
    "CLASS_10_PLUS_2",
    "GRADUATE",
    "POST_GRADUATE",
    "CERTIFICATION_STUDENT",
    "CERTIFICATION_UG",
  ];

  console.log(`career library entries read: ${entries.length}`);
  console.log(`roles yielding no education path: ${rolesWithNothing}`);
  const described = [...wanted.values()].filter((w) => w.description != null).length;
  console.log(`distinct programmes: ${wanted.size}  |  role links: ${totalLinks}`);
  console.log(`with a description: ${described}  |  discarded conflicting descriptions: ${descriptionConflicts}`);
  for (const level of LEVELS) {
    const rows = [...wanted.values()].filter((w) => w.level === level);
    const links = rows.reduce((n, w) => n + w.careerIds.length, 0);
    console.log(`  ${level.padEnd(22)} ${String(rows.length).padStart(5)} programmes, ${links} links`);
  }

  if (dryRun) {
    // Show the least-used programmes per level: parse debris always lands in the tail, so
    // this is where you look to judge whether a heuristic is behaving.
    for (const level of LEVELS) {
      const rows = [...wanted.values()]
        .filter((w) => w.level === level)
        .sort((a, b) => a.careerIds.length - b.careerIds.length);
      console.log(`\n${level} - 10 rarest:`);
      for (const r of rows.slice(0, 10)) {
        const desc = r.description ? `  -- ${r.description.slice(0, 60)}` : "";
        console.log(`   ${String(r.careerIds.length).padStart(4)}x  ${r.programme.slice(0, 60)}${desc}`);
      }
    }
    console.log("\n--dry-run: nothing written.");
    return { programmes: wanted.size, links: totalLinks, created: 0, linked: 0 };
  }

  // Reuse a live entry if one already exists (an admin may have added it by hand), so this
  // stays idempotent and never duplicates a programme.
  let created = 0;
  let describedExisting = 0;
  const idByKey = new Map<string, string>();
  for (const w of wanted.values()) {
    const existing = await prisma.educationEntry.findUnique({
      where: { level_programme: { level: w.level, programme: w.programme } },
      select: { id: true, description: true },
    });
    if (existing) {
      // Backfill a description onto a row that predates this column being sourced, but
      // never overwrite one an admin may have edited by hand.
      if (existing.description == null && w.description != null) {
        await prisma.educationEntry.update({
          where: { id: existing.id },
          data: { description: w.description },
        });
        describedExisting++;
      }
      idByKey.set(`${w.level} ${w.programme}`, existing.id);
      continue;
    }
    const row = await prisma.educationEntry.create({
      data: {
        level: w.level,
        programme: w.programme,
        description: w.description,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    idByKey.set(`${w.level} ${w.programme}`, row.id);
    created++;
  }

  const links = [...wanted.values()].flatMap((w) =>
    w.careerIds.map((careerEntryId) => ({
      careerEntryId,
      educationEntryId: idByKey.get(`${w.level} ${w.programme}`)!,
    }))
  );
  const { count: linked } = await prisma.careerEducationEntry.createMany({
    data: links,
    skipDuplicates: true, // re-runs add only what's missing
  });

  console.log(
    `\nwrote ${created} new education entries, ${linked} new role links` +
      `, backfilled ${describedExisting} descriptions.`
  );
  return { programmes: wanted.size, links: totalLinks, created, linked };
}

const invokedDirectly = process.argv[1]?.includes("seed-education-path");
if (invokedDirectly) {
  seedEducationPath({ dryRun: process.argv.includes("--dry-run") })
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
