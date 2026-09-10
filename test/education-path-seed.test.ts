import { describe, expect, it } from "vitest";
import {
  deriveForEntry,
  graduationProgrammes,
  postGraduateProgrammes,
} from "../prisma/seed-education-path.js";

// The seed derives Education Path rows from prose-ish workbook columns, so the parsing
// rules are where the risk is. These are pure — no DB.
//
// The "Focus Electives:" split now happens at export time (scripts/export-career-library.py
// split_qualification()), so graduationProgrammes()/postGraduateProgrammes() here operate on
// the already-isolated plain degree list, not the combined "<degrees>, Focus Electives: ..."
// cell text.

describe("Education Path seed — graduation parsing", () => {
  it("splits a plain degree list into programmes", () => {
    expect(graduationProgrammes("BTech / BSc / BCA / Statistics / Maths")).toEqual([
      "BTech",
      "BSc",
      "BCA",
      "Statistics",
      "Maths",
    ]);
  });

  it("strips the 'or a closely related field' hedge rather than baking it into the name", () => {
    expect(graduationProgrammes("BSc Food Science (or a closely related field)")).toEqual([
      "BSc Food Science",
    ]);
    expect(graduationProgrammes("BVSc (or an equivalent degree)")).toEqual(["BVSc"]);
  });

  it("keeps a parenthesised specialisation list as one programme", () => {
    expect(graduationProgrammes("BDes (Product, Interaction)")).toEqual(["BDes (Product, Interaction)"]);
  });

  it("returns nothing for junk or empty source values", () => {
    expect(graduationProgrammes("January")).toEqual([]);
    expect(graduationProgrammes(null)).toEqual([]);
    expect(graduationProgrammes("")).toEqual([]);
  });
});

describe("Education Path seed — PG parsing", () => {
  it("splits a plain PG degree list into programmes", () => {
    expect(
      postGraduateProgrammes("MSc Data Science, MBA Business Analytics, MTech Data Science")
    ).toEqual(["MSc Data Science", "MBA Business Analytics", "MTech Data Science"]);
  });

  it("does not split inside parentheses", () => {
    expect(postGraduateProgrammes("M.Arch (Urban Design, Landscape, Sustainable Architecture)")).toEqual([
      "M.Arch (Urban Design, Landscape, Sustainable Architecture)",
    ]);
  });

  it("returns nothing for junk or empty source values", () => {
    expect(postGraduateProgrammes("January")).toEqual([]);
    expect(postGraduateProgrammes(null)).toEqual([]);
    expect(postGraduateProgrammes("")).toEqual([]);
  });
});

describe("Education Path seed — per-role derivation", () => {
  const base = {
    qualification10th12th: "12th PCM from a recognized board",
    qualification10th12thExplanation: "Minimum aggregate as per institution norms",
    qualificationGraduation: "BTech / BSc",
    qualificationGraduationDefined: "Focus Electives: CS.",
    qualificationPG: "MTech AI, MSc CS",
    qualificationPGDefined: "a relevant Master's building on CS",
    certificationsStudent: ["Python Basics"],
    certificationsUG: ["AWS Cloud Practitioner"],
  };

  it("covers all five levels from their own source columns", () => {
    const derived = deriveForEntry(base);
    expect(derived).toEqual(
      expect.arrayContaining([
        { level: "GRADUATE", programme: "BTech", description: "Focus Electives: CS." },
        { level: "GRADUATE", programme: "BSc", description: "Focus Electives: CS." },
        { level: "POST_GRADUATE", programme: "MTech AI", description: "a relevant Master's building on CS" },
        { level: "POST_GRADUATE", programme: "MSc CS", description: "a relevant Master's building on CS" },
      ])
    );
  });

  it("takes each level's description from its own explanation column", () => {
    const byLevel = Object.fromEntries(deriveForEntry(base).map((d) => [`${d.level} ${d.programme}`, d.description]));
    // 10+2 explanation, graduation "Defined", PG "Defined" — the electives half of the
    // combined cell is unusable as a programme name but is exactly right as prose.
    expect(byLevel["CLASS_10_PLUS_2 12th PCM from a recognized board"]).toBe(
      "Minimum aggregate as per institution norms"
    );
    expect(byLevel["POST_GRADUATE MTech AI"]).toBe("a relevant Master's building on CS");
    // Certifications have no explanation column anywhere in the workbook.
    expect(byLevel["CERTIFICATION_STUDENT Python Basics"]).toBeNull();
    expect(byLevel["CERTIFICATION_UG AWS Cloud Practitioner"]).toBeNull();
  });

  it("dedupes a programme repeated within one role", () => {
    const derived = deriveForEntry({
      ...base,
      certificationsStudent: ["Python Basics", "Python Basics"],
    });
    const python = derived.filter((d) => d.programme === "Python Basics");
    expect(python).toHaveLength(1);
  });

  it("yields nothing for a fully junked row", () => {
    expect(
      deriveForEntry({
        qualification10th12th: "January",
        qualification10th12thExplanation: "January",
        qualificationGraduation: "January",
        qualificationGraduationDefined: "January",
        qualificationPG: "January",
        qualificationPGDefined: null,
        certificationsStudent: ["January"],
        certificationsUG: ["January"],
      })
    ).toEqual([]);
  });
});
