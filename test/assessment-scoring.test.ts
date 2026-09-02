import { describe, expect, it } from "vitest";
import { class9to10AssessmentQuestions } from "../prisma/seed-data/assessment/class9to10.js";
import { scoreRiasec } from "../src/modules/assessment/scoring/riasec.js";
import { scoreBigFive } from "../src/modules/assessment/scoring/bigfive.js";
import { scoreCognitive } from "../src/modules/assessment/scoring/cognitive.js";
import { scoreAptitude } from "../src/modules/assessment/scoring/aptitude.js";
import {
  computeDifficultyConsistency,
  difficultyConsistencyPenalty,
} from "../src/modules/assessment/scoring/ari.js";
import { computeAci } from "../src/modules/assessment/scoring/aci.js";
import { computeOri } from "../src/modules/assessment/scoring/ori.js";
import { computeRvs } from "../src/modules/assessment/scoring/rvs.js";
import { MIRROR_PAIRS } from "../src/modules/assessment/scoring/config.js";
import { resolveDominantCareerStyle } from "../src/modules/assessment/scoring/dcs.js";
import { resolveDominantPersonalityStyle } from "../src/modules/assessment/scoring/dps.js";
import { scoreStreamFit } from "../src/modules/assessment/scoring/streamFit.js";
import { scoreCareerFit, aiResilienceRank, type DomainUnit } from "../src/modules/assessment/scoring/careerFit.js";
import { scoreGraduationPathways } from "../src/modules/assessment/scoring/graduationFit.js";
import { scoreAssessment } from "../src/modules/assessment/scoring/index.js";
import type {
  AnsweredQuestion,
  Difficulty,
  Layer,
  TraitKey,
} from "../src/modules/assessment/scoring/types.js";

// --- helpers -------------------------------------------------------------------

let codeSeq = 0;
function mk(
  overrides: Partial<AnsweredQuestion> & { section: Layer; trait: TraitKey; response: number | string }
): AnsweredQuestion {
  return {
    questionCode: overrides.questionCode ?? `T${codeSeq++}`,
    section: overrides.section,
    trait: overrides.trait,
    traitCode: overrides.traitCode ?? null,
    difficulty: overrides.difficulty ?? null,
    weight: overrides.weight ?? 1,
    correctOption: overrides.correctOption ?? null,
    format: overrides.format ?? (overrides.section === "APTITUDE" ? "MCQ_SINGLE" : "LIKERT_5"),
    order: overrides.order ?? 0,
    response: overrides.response,
    timeTakenMs: overrides.timeTakenMs ?? null,
  };
}

// Four Likert items for one trait with the given responses.
function likertTrait(section: Layer, trait: TraitKey, responses: number[], codes?: string[]): AnsweredQuestion[] {
  return responses.map((r, i) => mk({ section, trait, response: r, questionCode: codes?.[i] }));
}

// --- RIASEC --------------------------------------------------------------------

describe("RIASEC scoring", () => {
  it("computes the Construct's Enterprising example: 4+5+4+3 = 16/20 = 80%", () => {
    const answers = [
      ...likertTrait("RIASEC", "ENTERPRISING", [4, 5, 4, 3]),
      ...likertTrait("RIASEC", "REALISTIC", [1, 1, 1, 1]),
      ...likertTrait("RIASEC", "INVESTIGATIVE", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "ARTISTIC", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "SOCIAL", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "CONVENTIONAL", [2, 2, 2, 2]),
    ];
    const { scores } = scoreRiasec(answers);
    const ent = scores.find((s) => s.trait === "ENTERPRISING")!;
    expect(ent.score).toBe(80);
    expect(ent.level).toBe("Highly Preferred");
    expect(ent.neutralCount).toBe(1);
  });

  it("flags all-low and undifferentiated profiles", () => {
    const answers = [
      ...likertTrait("RIASEC", "REALISTIC", [2, 2, 2, 2]), // 40%
      ...likertTrait("RIASEC", "INVESTIGATIVE", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "ARTISTIC", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "SOCIAL", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "ENTERPRISING", [2, 2, 2, 2]),
      ...likertTrait("RIASEC", "CONVENTIONAL", [2, 2, 2, 2]),
    ];
    const { flags } = scoreRiasec(answers);
    expect(flags).toContain("No Strong RIASEC Preference Emerging – recommend qualitative follow-up");
    expect(flags).toContain("Highly Undifferentiated Profile");
  });

  it("breaks trait ties by fewer neutrals, then the I>E>S>A>C>R fallback order", () => {
    // Social and Enterprising both score 80 (16/20). Social has a neutral (3), so
    // Enterprising (no neutrals) ranks above it despite the equal score.
    const answers = [
      ...likertTrait("RIASEC", "REALISTIC", [1, 1, 1, 1]),
      ...likertTrait("RIASEC", "INVESTIGATIVE", [1, 1, 1, 1]),
      ...likertTrait("RIASEC", "ARTISTIC", [1, 1, 1, 1]),
      ...likertTrait("RIASEC", "SOCIAL", [5, 5, 3, 3]), // 16/20 = 80, 2 neutrals
      ...likertTrait("RIASEC", "ENTERPRISING", [4, 4, 4, 4]), // 16/20 = 80, 0 neutrals
      ...likertTrait("RIASEC", "CONVENTIONAL", [1, 1, 1, 1]),
    ];
    const { ranking } = scoreRiasec(answers);
    expect(ranking.slice(0, 2)).toEqual(["ENTERPRISING", "SOCIAL"]);
  });
});

// --- Big Five (reverse keying) -------------------------------------------------

describe("Big Five scoring", () => {
  it("applies reverse scoring (6 - response) for reverse-keyed items", () => {
    // Openness O1-O3 = 5, O4 is Q28 (reverse-keyed) punched 5 -> counts as 1.
    // Effective 5+5+5+1 = 16/20 = 80%.
    const answers = [
      mk({ section: "BIG_FIVE", trait: "OPENNESS", response: 5, questionCode: "Q25" }),
      mk({ section: "BIG_FIVE", trait: "OPENNESS", response: 5, questionCode: "Q26" }),
      mk({ section: "BIG_FIVE", trait: "OPENNESS", response: 5, questionCode: "Q27" }),
      mk({ section: "BIG_FIVE", trait: "OPENNESS", response: 5, questionCode: "Q28" }),
      ...likertTrait("BIG_FIVE", "CONSCIENTIOUSNESS", [3, 3, 3, 3]),
      ...likertTrait("BIG_FIVE", "EXTRAVERSION", [3, 3, 3, 3]),
      ...likertTrait("BIG_FIVE", "AGREEABLENESS", [3, 3, 3, 3]),
      ...likertTrait("BIG_FIVE", "EMOTIONAL_STABILITY", [3, 3, 3, 3]),
    ];
    const { scores } = scoreBigFive(answers);
    expect(scores.find((s) => s.trait === "OPENNESS")!.score).toBe(80);
  });
});

// --- Aptitude ------------------------------------------------------------------

describe("Aptitude scoring", () => {
  function aptTrait(trait: TraitKey, correctness: boolean[]): AnsweredQuestion[] {
    const specs: [Difficulty, number][] = [
      ["EASY", 1],
      ["EASY", 1],
      ["MEDIUM", 1.5],
      ["MEDIUM", 1.5],
      ["HARD", 2],
    ];
    return specs.map(([difficulty, weight], i) =>
      mk({
        section: "APTITUDE",
        trait,
        difficulty,
        weight,
        correctOption: "A",
        response: correctness[i] ? "A" : "B",
      })
    );
  }

  it("computes the Construct's Numerical example: 1 + 1.5 + 2 = 4.5/7 = 64.29%", () => {
    const answers = [
      ...aptTrait("NUMERICAL", [true, false, true, false, true]), // 1 + 1.5 + 2 = 4.5
      ...aptTrait("VERBAL", [false, false, false, false, false]),
      ...aptTrait("LOGICAL", [false, false, false, false, false]),
      ...aptTrait("SPATIAL", [false, false, false, false, false]),
    ];
    const { scores } = scoreAptitude(answers);
    expect(scores.find((s) => s.trait === "NUMERICAL")!.score).toBe(64.29);
  });

  it("treats 'Not Sure' (E) as incorrect", () => {
    const answers = [
      ...aptTrait("NUMERICAL", [true, true, true, true, true]).map((q) => ({ ...q, response: "E" })),
      ...aptTrait("VERBAL", [false, false, false, false, false]),
      ...aptTrait("LOGICAL", [false, false, false, false, false]),
      ...aptTrait("SPATIAL", [false, false, false, false, false]),
    ];
    const { scores } = scoreAptitude(answers);
    expect(scores.find((s) => s.trait === "NUMERICAL")!.score).toBe(0);
  });
});

// --- Difficulty Consistency ----------------------------------------------------

describe("Difficulty Consistency (DC)", () => {
  const specs: [Difficulty, number][] = [
    ["EASY", 1],
    ["EASY", 1],
    ["MEDIUM", 1.5],
    ["MEDIUM", 1.5],
    ["HARD", 2],
  ];
  function pattern(correctness: boolean[]): AnsweredQuestion[] {
    return specs.map(([difficulty, weight], i) =>
      mk({
        section: "APTITUDE",
        trait: "NUMERICAL",
        difficulty,
        weight,
        correctOption: "A",
        response: correctness[i] ? "A" : "B",
      })
    );
  }

  it("penalizes 'Hard correct + all others wrong' by 75 (DC = 25)", () => {
    // Possibility 1 from the Construct penalty table.
    const penalty = difficultyConsistencyPenalty(pattern([false, false, false, false, true]));
    expect(penalty).toBe(-75);
  });

  it("gives no penalty for a normal easy->hard gradient", () => {
    expect(difficultyConsistencyPenalty(pattern([true, true, true, false, false]))).toBe(0);
  });

  it("averages DC across the four aptitude traits", () => {
    const answers = [
      ...["NUMERICAL", "VERBAL", "LOGICAL", "SPATIAL"].flatMap((t) =>
        specs.map(([difficulty, weight], i) =>
          mk({
            section: "APTITUDE",
            trait: t as TraitKey,
            difficulty,
            weight,
            correctOption: "A",
            // Only the hard question correct -> possibility 1 -> DC 25 for every trait.
            response: i === 4 ? "A" : "B",
          })
        )
      ),
    ];
    expect(computeDifficultyConsistency(answers).dc).toBe(25);
  });
});

// --- ACI / ORI -----------------------------------------------------------------

describe("ACI (Aptitude Confidence Index)", () => {
  it("computes DK% and grades 3/20 = 15% as High Confidence", () => {
    const answers = Array.from({ length: 20 }, (_, i) =>
      mk({ section: "APTITUDE", trait: "NUMERICAL", correctOption: "A", response: i < 3 ? "E" : "A" })
    );
    const aci = computeAci(answers);
    expect(aci.dkPercent).toBe(15);
    expect(aci.level).toBe("High Confidence");
  });
});

describe("ORI (completion-time reliability)", () => {
  const start = new Date("2026-01-01T10:00:00Z");
  it("grades a 30-minute completion as High Reliability", () => {
    const ori = computeOri(start, new Date(start.getTime() + 30 * 60000));
    expect(ori.completionMinutes).toBe(30);
    expect(ori.level).toBe("High Reliability");
  });
  it("grades a 10-minute completion as Very Low Reliability", () => {
    expect(computeOri(start, new Date(start.getTime() + 10 * 60000)).level).toBe("Very Low Reliability");
  });
});

// --- RVS (Response Validity Score) ---------------------------------------------

describe("RVS (internal consistency)", () => {
  // A fully-consistent baseline: every mirror pair rated far apart (gap 4).
  function baseConsistent(): Record<string, number> {
    const m: Record<string, number> = {};
    for (const p of MIRROR_PAIRS) {
      m[p.a] = 5;
      m[p.b] = 1;
    }
    return m;
  }
  function rvsAnswers(resp: Record<string, number>): AnsweredQuestion[] {
    return Object.entries(resp).map(([questionCode, response]) =>
      mk({ section: "BIG_FIVE", trait: "OPENNESS", response, questionCode })
    );
  }

  it("scores a fully-consistent profile at 100 (Highly Consistent)", () => {
    const rvs = computeRvs(rvsAnswers(baseConsistent()));
    expect(rvs.score).toBe(100);
    expect(rvs.contradictionCount).toBe(0);
    expect(rvs.level).toBe("Highly Consistent Profile");
    expect(rvs.evaluatedPairs).toBe(10);
  });

  it("sums penalties: 5 strong contradictions = 100 - 50 = 50 (Inconsistent)", () => {
    const m = baseConsistent();
    // MP1..MP5 -> both items equal -> gap 0 -> strong. (MP1-MP5 share no question.)
    for (const p of MIRROR_PAIRS.slice(0, 5)) {
      m[p.a] = 5;
      m[p.b] = 5;
    }
    const rvs = computeRvs(rvsAnswers(m));
    expect(rvs.strongCount).toBe(5);
    expect(rvs.totalPenalty).toBe(-50);
    expect(rvs.score).toBe(50);
    expect(rvs.level).toBe("Inconsistent Profile");
  });

  it("penalizes a mild contradiction (gap 1) by 5", () => {
    const m = baseConsistent();
    const first = MIRROR_PAIRS[0]!;
    m[first.a] = 5;
    m[first.b] = 4; // gap 1 -> mild
    const rvs = computeRvs(rvsAnswers(m));
    expect(rvs.mildCount).toBe(1);
    expect(rvs.score).toBe(95);
    expect(rvs.level).toBe("Highly Consistent Profile");
  });

  it("treats gap 2 as acceptable (no penalty)", () => {
    const m = baseConsistent();
    const first = MIRROR_PAIRS[0]!;
    m[first.a] = 5;
    m[first.b] = 3; // gap 2 -> acceptable
    expect(computeRvs(rvsAnswers(m)).score).toBe(100);
  });

  it("clamps at 0 when every pair is a strong contradiction", () => {
    const m: Record<string, number> = {};
    for (const p of MIRROR_PAIRS) {
      m[p.a] = 5;
      m[p.b] = 5;
    }
    expect(computeRvs(rvsAnswers(m)).score).toBe(0);
  });
});

// --- DCS / DPS lookups ---------------------------------------------------------

describe("Dominant style lookups", () => {
  it("resolves a RIASEC top-3 ranking to its 120-code style", () => {
    const dcs = resolveDominantCareerStyle([
      "REALISTIC",
      "INVESTIGATIVE",
      "ARTISTIC",
      "SOCIAL",
      "ENTERPRISING",
      "CONVENTIONAL",
    ]);
    expect(dcs.code).toBe("RIA");
    expect(dcs.style).toBe("Technical Investigator");
  });

  it("resolves a Big Five top-2 ranking to its 20-code style", () => {
    const dps = resolveDominantPersonalityStyle([
      "OPENNESS",
      "CONSCIENTIOUSNESS",
      "EXTRAVERSION",
      "AGREEABLENESS",
      "EMOTIONAL_STABILITY",
    ]);
    expect(dps.code).toBe("O-C");
    expect(dps.style).toBe("Innovative Planner");
  });
});

// --- Stream Fit ----------------------------------------------------------------

describe("Stream Fit", () => {
  const traits: TraitKey[] = [
    "REALISTIC", "INVESTIGATIVE", "ARTISTIC", "SOCIAL", "ENTERPRISING", "CONVENTIONAL",
    "OPENNESS", "CONSCIENTIOUSNESS", "EXTRAVERSION", "AGREEABLENESS", "EMOTIONAL_STABILITY",
    "NUMERICAL", "VERBAL", "LOGICAL", "SPATIAL",
    "LEARNING_VELOCITY", "UNCERTAINTY_TOLERANCE", "AUTONOMY_PREFERENCE",
  ];
  function profile(value: number): Record<TraitKey, number> {
    return Object.fromEntries(traits.map((t) => [t, value])) as Record<TraitKey, number>;
  }

  it("gives every sub-stream a fit of 100 for an all-100 profile (weights sum to 100)", () => {
    const { ranked } = scoreStreamFit(profile(100));
    expect(ranked.every((s) => s.fitScore === 100)).toBe(true);
    expect(ranked[0]!.level).toBe("Strong Fit");
  });

  it("returns the top 3 sub-streams sorted by fit, descending", () => {
    const p = profile(50);
    p.INVESTIGATIVE = 100; // lift investigative-heavy streams
    const { top3, ranked } = scoreStreamFit(p);
    expect(top3).toHaveLength(3);
    expect(ranked[0]!.fitScore).toBeGreaterThanOrEqual(ranked[1]!.fitScore);
    expect(top3[0]!.fitScore).toBe(ranked[0]!.fitScore);
  });
});

// --- Career Fit / Graduation Pathways ------------------------------------------

const ALL_TRAITS: TraitKey[] = [
  "REALISTIC", "INVESTIGATIVE", "ARTISTIC", "SOCIAL", "ENTERPRISING", "CONVENTIONAL",
  "OPENNESS", "CONSCIENTIOUSNESS", "EXTRAVERSION", "AGREEABLENESS", "EMOTIONAL_STABILITY",
  "NUMERICAL", "VERBAL", "LOGICAL", "SPATIAL",
  "LEARNING_VELOCITY", "UNCERTAINTY_TOLERANCE", "AUTONOMY_PREFERENCE",
];
function makeProfile(overrides: Partial<Record<TraitKey, number>> = {}, base = 0): Record<TraitKey, number> {
  const p = Object.fromEntries(ALL_TRAITS.map((t) => [t, base])) as Record<TraitKey, number>;
  return { ...p, ...overrides };
}

describe("Career Fit", () => {
  it("maps AI-resilience grades to a rank (higher = more resilient)", () => {
    expect(aiResilienceRank("VERY_HIGH")).toBeGreaterThan(aiResilienceRank("HIGH"));
    expect(aiResilienceRank("HIGH")).toBeGreaterThan(aiResilienceRank("LOW"));
    expect(aiResilienceRank(null)).toBe(0);
  });

  it("ranks the better-matched industry first and grades it", () => {
    // Architecture weights = R20 / A35 / Consc15 / Log5 / Spatial25 (sums to 100).
    const profile = makeProfile({ ARTISTIC: 100, SPATIAL: 100, REALISTIC: 100 });
    const units: DomainUnit[] = [
      { cluster: "Information Technology & Digital", industry: "Data Science & Artificial Intelligence", domain: "All Domains", bestAiResilienceRank: 3 },
      { cluster: "Engineering", industry: "Architecture", domain: "All Domains", bestAiResilienceRank: 4 },
    ];
    const { rankedDomains, top3Industries } = scoreCareerFit(profile, units);
    expect(rankedDomains[0]!.industry).toBe("Architecture");
    expect(rankedDomains[0]!.fitScore).toBe(80); // 20+35+25 of a 100-valued profile
    expect(rankedDomains[0]!.level).toBe("Strong Fit");
    expect(top3Industries[0]!.industry).toBe("Architecture");
  });

  it("spreads top-6 across distinct industries (best domain per industry)", () => {
    const profile = makeProfile({}, 70); // >= the 60 Fit qualifying floor so both qualify
    const units: DomainUnit[] = [
      { cluster: "Engineering", industry: "Architecture", domain: "Residential", bestAiResilienceRank: 2 },
      { cluster: "Engineering", industry: "Architecture", domain: "Commercial", bestAiResilienceRank: 4 },
      { cluster: "IT", industry: "Data Science & Artificial Intelligence", domain: "All Domains", bestAiResilienceRank: 3 },
    ];
    const { top6Domains } = scoreCareerFit(profile, units);
    const industries = top6Domains.map((d) => d.industry);
    expect(new Set(industries).size).toBe(industries.length); // no repeats
    // Architecture's two domains tie on fit -> the higher AI-resilience one is chosen.
    const arch = top6Domains.find((d) => d.industry === "Architecture")!;
    expect(arch.domain).toBe("Commercial");
  });

  it("drops weak-fit (< 60) careers from the surfaced top lists but keeps them in rankedDomains", () => {
    const profile = makeProfile({}, 40); // uniform 40 -> every domain fits at 40 (Weak Fit)
    const units: DomainUnit[] = [
      { cluster: "Engineering", industry: "Architecture", domain: "All Domains", bestAiResilienceRank: 4 },
      { cluster: "IT", industry: "Data Science & Artificial Intelligence", domain: "All Domains", bestAiResilienceRank: 3 },
    ];
    const { rankedDomains, top6Domains, top3Industries } = scoreCareerFit(profile, units);
    expect(rankedDomains.length).toBeGreaterThan(0); // full list still carries the weak fits
    expect(rankedDomains.every((d) => d.level === "Weak Fit")).toBe(true);
    expect(top6Domains).toHaveLength(0); // none meet the required Fit Score
    expect(top3Industries).toHaveLength(0);
  });
});

describe("Graduation Pathways", () => {
  it("scores every graduate stream at 100 for an all-100 profile", () => {
    const { ranked, top3 } = scoreGraduationPathways(makeProfile({}, 100));
    expect(ranked.every((g) => g.fitScore === 100)).toBe(true);
    expect(top3).toHaveLength(3);
    expect(top3[0]!.level).toBe("Strong Fit");
  });

  it("ranks by fit, descending", () => {
    const { ranked } = scoreGraduationPathways(makeProfile({ ARTISTIC: 100, OPENNESS: 100 }));
    expect(ranked[0]!.fitScore).toBeGreaterThanOrEqual(ranked[1]!.fitScore);
  });
});

// --- Orchestrator smoke test (built from the real seeded question bank) ---------

describe("scoreAssessment (full attempt)", () => {
  function fullAnswers(pick: (q: (typeof class9to10AssessmentQuestions)[number]) => number | string): AnsweredQuestion[] {
    return class9to10AssessmentQuestions.map((q, idx) => ({
      questionCode: q.questionCode,
      section: q.section as Layer,
      trait: q.trait as TraitKey,
      traitCode: q.traitCode ?? null,
      difficulty: (q.difficulty as Difficulty | undefined) ?? null,
      weight: q.weight ?? 1,
      correctOption: q.correctOption ?? null,
      format: q.format,
      order: q.order ?? idx,
      response: pick(q),
      timeTakenMs: null,
    }));
  }

  it("produces a complete report with all layers, styles, stream fit and reliability", () => {
    const answers = fullAnswers((q) =>
      q.section === "APTITUDE" ? q.correctOption ?? "E" : 4
    );
    const start = new Date("2026-01-01T10:00:00Z");
    const domainUnits: DomainUnit[] = [
      { cluster: "Engineering", industry: "Architecture", domain: "All Domains", bestAiResilienceRank: 4 },
      { cluster: "IT", industry: "Data Science & Artificial Intelligence", domain: "All Domains", bestAiResilienceRank: 3 },
    ];
    const report = scoreAssessment({
      answers,
      startedAt: start,
      submittedAt: new Date(start.getTime() + 30 * 60000),
      domainUnits,
    });

    expect(Object.keys(report.traitScores)).toHaveLength(18);
    // All-correct aptitude -> every aptitude area 100%.
    expect(report.aptitude.scores.every((s) => s.score === 100)).toBe(true);
    // Uniform "Agree" on Likert -> 80% everywhere.
    expect(report.riasec.scores.every((s) => s.score === 80)).toBe(true);
    expect(report.dominantCareerStyle.code).toHaveLength(3);
    expect(report.dominantPersonalityStyle.code).toContain("-");
    expect(report.streamFit.top3).toHaveLength(3);
    expect(report.reliability.ori.level).toBe("High Reliability");
    expect(report.reliability.aci.dkPercent).toBe(0);
    // Timing not supplied -> TC/ARI deferred, DC still present.
    expect(report.reliability.ari.timingAvailable).toBe(false);
    expect(report.reliability.ari.ari).toBeNull();
    expect(report.reliability.ari.dc).toBe(100);
    // Uniform "Agree" (4) on every Likert item -> each mirror pair has gap 0 (both 4)
    // -> all strong contradictions -> RVS floors at 0. Uniform answering is exactly
    // what internal-consistency checks are meant to flag.
    expect(report.reliability.rvs.score).toBe(0);
    expect(report.reliability.rvs.level).toBe("Inconsistent Profile");
    expect(report.meta.pending).not.toContain("rvs");
    // Graduation Pathways always computes; Career Fit computes when domainUnits given.
    expect(report.graduationPathways.top3).toHaveLength(3);
    expect(report.careerFit).not.toBeNull();
    expect(report.careerFit!.top3Industries.length).toBeGreaterThan(0);
    expect(report.meta.pending).not.toContain("careerFit");
  });

  it("computes TC and the composite ARI once every aptitude answer carries timing", () => {
    // Every aptitude item answered correctly and unhurried (>5s) -> no TC penalty.
    const answers = fullAnswers((q) => (q.section === "APTITUDE" ? q.correctOption ?? "E" : 4)).map(
      (a) => ({ ...a, timeTakenMs: 20_000 })
    );
    const start = new Date("2026-01-01T10:00:00Z");
    const report = scoreAssessment({
      answers,
      startedAt: start,
      submittedAt: new Date(start.getTime() + 30 * 60000),
    });

    expect(report.reliability.ari.timingAvailable).toBe(true);
    expect(report.reliability.ari.tc).toBe(100);
    expect(report.reliability.ari.dc).toBe(100);
    expect(report.reliability.ari.ari).not.toBeNull();
    expect(report.reliability.ari.ari!.score).toBe(100);
    expect(report.reliability.ari.ari!.level).toBeTruthy();
    // No longer deferred once timing is present.
    expect(report.meta.pending).not.toContain("ari");
    expect(report.meta.pending).not.toContain("timeConsistency");
    expect(report.meta.timingAvailable).toBe(true);
  });

  it("keeps TC/ARI deferred when only some aptitude answers carry timing", () => {
    let stamped = false;
    const answers = fullAnswers((q) => (q.section === "APTITUDE" ? q.correctOption ?? "E" : 4)).map((a) => {
      if (a.section !== "APTITUDE" || stamped) return a;
      stamped = true;
      return { ...a, timeTakenMs: 20_000 };
    });
    const start = new Date("2026-01-01T10:00:00Z");
    const report = scoreAssessment({
      answers,
      startedAt: start,
      submittedAt: new Date(start.getTime() + 30 * 60000),
    });

    expect(report.reliability.ari.timingAvailable).toBe(false);
    expect(report.reliability.ari.ari).toBeNull();
    expect(report.meta.pending).toContain("ari");
  });

  it("leaves Career Fit null (and pending) when no domainUnits are supplied", () => {
    const answers = fullAnswers((q) => (q.section === "APTITUDE" ? q.correctOption ?? "E" : 4));
    const start = new Date("2026-01-01T10:00:00Z");
    const report = scoreAssessment({
      answers,
      startedAt: start,
      submittedAt: new Date(start.getTime() + 30 * 60000),
    });
    expect(report.careerFit).toBeNull();
    expect(report.meta.pending).toContain("careerFit");
    expect(report.graduationPathways.top3).toHaveLength(3); // still computed
  });
});
