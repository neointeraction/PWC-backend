import { describe, expect, it } from "vitest";
import {
  deriveForEntry,
  graduationProgrammes,
  postGraduateProgrammes,
} from "../prisma/seed-education-path.js";

// The seed derives Education Path rows from prose-ish workbook columns, so the parsing
// rules are where the risk is. These are pure — no DB.

describe("Education Path seed — graduation parsing", () => {
  it("takes the degree list and drops the 'Recommended focus' guidance", () => {
    expect(
      graduationProgrammes("BTech / BSc / BCA / Statistics / Maths, Recommended focus: CS/IT/Maths.")
    ).toEqual(["BTech", "BSc", "BCA", "Statistics", "Maths"]);
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
  it("reads only what follows the PG: marker", () => {
    expect(
      postGraduateProgrammes("BTech/BSc/BCA. PG: MSc Data Science, MBA Business Analytics, MTech Data Science.")
    ).toEqual(["MSc Data Science", "MBA Business Analytics", "MTech Data Science"]);
  });

  it("does not split inside parentheses", () => {
    expect(postGraduateProgrammes("PG: M.Arch (Urban Design, Landscape, Sustainable Architecture)")).toEqual([
      "M.Arch (Urban Design, Landscape, Sustainable Architecture)",
    ]);
  });

  it("yields nothing when the marker is absent — the boilerplate columns aren't mined", () => {
    expect(
      postGraduateProgrammes(
        "a relevant Master's / PG programme building on Acrobatics, or an equivalent specialization aligned with Movement Arts."
      )
    ).toEqual([]);
  });
});

describe("Education Path seed — per-role derivation", () => {
  const base = {
    qualification10th12th: "12th PCM from a recognized board",
    qualification10th12thExplanation: "Minimum aggregate as per institution norms",
    qualificationGraduationDefined: "BTech / BSc, Recommended focus: CS.",
    qualificationPG: "BTech. PG: MTech AI, MSc CS.",
    qualificationPGDefined: "a relevant Master's building on CS",
    certificationsStudent: ["Python Basics"],
    certificationsUG: ["AWS Cloud Practitioner"],
  };

  it("covers all five levels from their own source columns", () => {
    const derived = deriveForEntry(base);
    expect(derived).toEqual(
      expect.arrayContaining([
        { level: "GRADUATE", programme: "BTech", description: "BTech / BSc, Recommended focus: CS." },
        { level: "GRADUATE", programme: "BSc", description: "BTech / BSc, Recommended focus: CS." },
        { level: "POST_GRADUATE", programme: "MTech AI", description: "a relevant Master's building on CS" },
        { level: "POST_GRADUATE", programme: "MSc CS", description: "a relevant Master's building on CS" },
      ])
    );
  });

  it("takes each level's description from its own explanation column", () => {
    const byLevel = Object.fromEntries(deriveForEntry(base).map((d) => [`${d.level} ${d.programme}`, d.description]));
    // 10+2 explanation, graduation "Defined", PG "Defined" — the PG boilerplate is unusable
    // as a programme name but is exactly right as prose.
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
        qualificationGraduationDefined: "January",
        qualificationPG: "January",
        qualificationPGDefined: null,
        certificationsStudent: ["January"],
        certificationsUG: ["January"],
      })
    ).toEqual([]);
  });
});
