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
//   GRADUATE              <- qualificationGraduationDefined, everything before
//                            ", Recommended focus:", split on "/" and ",". That prefix is
//                            a genuine degree list ("BTech / BSc / BCA / Statistics").
//   POST_GRADUATE         <- qualificationPG, only the part after a literal "PG:" marker,
//                            split on ",". Rows without that marker contribute nothing.
//   CERTIFICATION_STUDENT <- certificationsStudent[] (already a list)
//   CERTIFICATION_UG      <- certificationsUG[] (already a list)
//
// Deliberately NOT used: qualificationPGDefined and qualificationGraduation are generated
// boilerplate sentences ("a relevant Master's / PG programme building on X, or an
// equivalent specialization aligned with Y"). Splitting those yields fragments, not
// programmes, so they are skipped rather than mined.
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

export function graduationProgrammes(value: string | null): string[] {
  // clean() would strip the hedge before the split, so work off the raw text here and
  // clean each part afterwards.
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  const head = raw.split(/,\s*Recommended focus:/i)[0];
  if (!head || JUNK.test(head)) return [];
  return splitTopLevel(head, /[/,]/).map(clean).filter(usable);
}

export function postGraduateProgrammes(value: string | null): string[] {
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  const marker = raw.match(/\bPG:\s*(.+)$/i);
  if (!marker?.[1]) return [];
  return splitTopLevel(marker[1], /,/).map(clean).filter(usable);
}

interface Derived {
  level: EducationPathLevel;
  programme: string;
}

export function deriveForEntry(entry: {
  qualification10th12th: string;
  qualificationGraduationDefined: string | null;
  qualificationPG: string | null;
  certificationsStudent: string[];
  certificationsUG: string[];
}): Derived[] {
  const out: Derived[] = [];
  const push = (level: EducationPathLevel, programme: string) => {
    const p = clean(programme);
    if (usable(p)) out.push({ level, programme: p });
  };

  push("CLASS_10_PLUS_2", entry.qualification10th12th);
  for (const p of graduationProgrammes(entry.qualificationGraduationDefined)) push("GRADUATE", p);
  for (const p of postGraduateProgrammes(entry.qualificationPG)) push("POST_GRADUATE", p);
  for (const c of entry.certificationsStudent) push("CERTIFICATION_STUDENT", c);
  for (const c of entry.certificationsUG) push("CERTIFICATION_UG", c);

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
      qualificationGraduationDefined: true,
      qualificationPG: true,
      certificationsStudent: true,
      certificationsUG: true,
    },
  });

  // level -> programme -> job role ids that reference it
  const wanted = new Map<string, { level: EducationPathLevel; programme: string; careerIds: string[] }>();
  let rolesWithNothing = 0;

  for (const entry of entries) {
    const derived = deriveForEntry(entry);
    if (derived.length === 0) rolesWithNothing++;
    for (const d of derived) {
      const key = `${d.level} ${d.programme}`;
      const bucket = wanted.get(key) ?? { level: d.level, programme: d.programme, careerIds: [] };
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
  console.log(`distinct programmes: ${wanted.size}  |  role links: ${totalLinks}`);
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
        console.log(`   ${String(r.careerIds.length).padStart(4)}x  ${r.programme.slice(0, 90)}`);
      }
    }
    console.log("\n--dry-run: nothing written.");
    return { programmes: wanted.size, links: totalLinks, created: 0, linked: 0 };
  }

  // Reuse a live entry if one already exists (an admin may have added it by hand), so this
  // stays idempotent and never duplicates a programme.
  let created = 0;
  const idByKey = new Map<string, string>();
  for (const w of wanted.values()) {
    const existing = await prisma.educationEntry.findFirst({
      where: { level: w.level, programme: w.programme, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      idByKey.set(`${w.level} ${w.programme}`, existing.id);
      continue;
    }
    const row = await prisma.educationEntry.create({
      data: { level: w.level, programme: w.programme, status: "APPROVED" },
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

  console.log(`\nwrote ${created} new education entries, ${linked} new role links.`);
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
