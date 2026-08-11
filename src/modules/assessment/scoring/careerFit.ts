// Career Matching Formula (Construct PDF): match the 18-trait profile against the
// career-domain weight table and surface the best-fitting career areas.
//
// The weight table is keyed by (industry, domain): most industries carry a single
// "All Domains" row that applies to every domain under them, while Defence / Merchant
// Navy / Entrepreneurship enumerate specific domains. We therefore score at the domain
// level, resolving each library domain's weights as: exact (industry, domain) row →
// industry "All Domains" row → industry average (fallback for the enumerated-domain
// industries).
//
// Selection interpretation (confirmed with PWC): rank industries by their best domain
// fit; the top 3 fill the report's "Industry Choice" table, and the top 6 industries'
// best domains become the six career cards — one representative career per area, so the
// recommendations spread across areas rather than clustering in one flat-weighted
// industry. The representative career itself (job role, salary, employers, …) is
// resolved from the library by the service layer, keyed on `industry` + `domain`, using
// highest AI-resilience as the tiebreak.

import { domainWeights } from "./data/domain-weights.js";
import { FIT_BANDS, FIT_QUALIFYING_MIN } from "./config.js";
import { weightedFit, type TraitScoreMap } from "./fit.js";
import { gradeByFloor } from "./grading.js";
import type { TraitKey } from "./types.js";

const ALL_DOMAINS = "All Domains";

// One distinct (cluster, industry, domain) present in the career library, plus the best
// AI-resilience rank among that domain's roles (VERY_HIGH=4 … LOW=1), used to break ties
// between equal-fit domains of the same industry.
export interface DomainUnit {
  cluster: string;
  industry: string;
  domain: string;
  bestAiResilienceRank: number;
}

// Placeholder the service replaces with the resolved career (see enrichCareerFit).
export interface RepresentativeCareer {
  jobRole: string;
  cluster: string;
  industry: string;
  domain: string;
  aiResilienceGrade: string;
  aiResilienceComment: string;
  oneLineDescription: string;
  topCompanies: string[];
  salaryIndiaRangeText: string | null;
  salaryGlobalRangeText: string | null;
}

export interface DomainFit {
  cluster: string;
  industry: string;
  domain: string;
  fitScore: number;
  level: string;
  meaning: string;
  bestAiResilienceRank: number;
  representativeCareer: RepresentativeCareer | null; // filled by the service for top 6
}

export interface IndustryRollup {
  cluster: string;
  industry: string;
  domain: string; // the best-fitting domain that set this industry's score
  fitScore: number;
  level: string;
  meaning: string;
}

export interface CareerFitResult {
  rankedDomains: DomainFit[]; // every scorable library domain, best fit first
  top6Domains: DomainFit[]; // best qualifying (>= FIT_QUALIFYING_MIN) domain per industry, up to 6
  top3Industries: IndustryRollup[]; // up to 3 qualifying industries
}

// --- weight resolution -------------------------------------------------------

interface ResolvedWeights {
  weights: Partial<Record<TraitKey, number>>;
  weightSum: number;
}

function buildWeightLookup() {
  const specific = new Map<string, ResolvedWeights>(); // `${industry}||${domain}`
  const allDomains = new Map<string, ResolvedWeights>(); // industry -> "All Domains"
  const perIndustryRows = new Map<string, ResolvedWeights[]>();

  for (const row of domainWeights) {
    const rw: ResolvedWeights = { weights: row.weights, weightSum: row.weightSum };
    if (row.domain === ALL_DOMAINS) {
      allDomains.set(row.industry, rw);
    } else {
      specific.set(`${row.industry}||${row.domain}`, rw);
    }
    const list = perIndustryRows.get(row.industry) ?? [];
    list.push(rw);
    perIndustryRows.set(row.industry, list);
  }

  // Average fallback for industries that only enumerate specific domains (no "All
  // Domains" row) — lets any library domain under them still be scored.
  const industryAverage = new Map<string, ResolvedWeights>();
  for (const [industry, list] of perIndustryRows) {
    if (allDomains.has(industry)) continue;
    const summed: Partial<Record<TraitKey, number>> = {};
    for (const rw of list) {
      for (const [trait, w] of Object.entries(rw.weights)) {
        summed[trait as TraitKey] = (summed[trait as TraitKey] ?? 0) + (w ?? 0) / list.length;
      }
    }
    const weightSum = Object.values(summed).reduce((a, b) => a + (b ?? 0), 0);
    industryAverage.set(industry, { weights: summed, weightSum });
  }

  return { specific, allDomains, industryAverage };
}

const WEIGHTS = buildWeightLookup();

function resolveWeights(industry: string, domain: string): ResolvedWeights | null {
  return (
    WEIGHTS.specific.get(`${industry}||${domain}`) ??
    WEIGHTS.allDomains.get(industry) ??
    WEIGHTS.industryAverage.get(industry) ??
    null
  );
}

// --- scoring -----------------------------------------------------------------

export function scoreCareerFit(profile: TraitScoreMap, domainUnits: DomainUnit[]): CareerFitResult {
  const rankedDomains: DomainFit[] = [];
  for (const unit of domainUnits) {
    const rw = resolveWeights(unit.industry, unit.domain);
    if (!rw) continue; // industry not in the weight table (shouldn't happen)
    const fitScore = weightedFit(rw.weights, profile, rw.weightSum);
    const { level, meaning } = gradeByFloor(fitScore, FIT_BANDS);
    rankedDomains.push({
      cluster: unit.cluster,
      industry: unit.industry,
      domain: unit.domain,
      fitScore,
      level,
      meaning,
      bestAiResilienceRank: unit.bestAiResilienceRank,
      representativeCareer: null,
    });
  }

  // Fit desc, then higher AI-resilience, then stable by industry/domain name.
  rankedDomains.sort(
    (a, b) =>
      b.fitScore - a.fitScore ||
      b.bestAiResilienceRank - a.bestAiResilienceRank ||
      a.industry.localeCompare(b.industry) ||
      a.domain.localeCompare(b.domain)
  );

  // Best domain per industry, in ranked order -> spread across industries.
  const seenIndustries = new Set<string>();
  const bestPerIndustry: DomainFit[] = [];
  for (const d of rankedDomains) {
    if (seenIndustries.has(d.industry)) continue;
    seenIndustries.add(d.industry);
    bestPerIndustry.push(d);
  }

  // Only recommend industries/careers meeting the required Fit Score — fewer than 6/3 if
  // that's all that qualifies (Construct PDF: weak-fit options "would not have been
  // considered"). The full `rankedDomains` list still carries every scored domain.
  const qualifying = bestPerIndustry.filter((d) => d.fitScore >= FIT_QUALIFYING_MIN);

  const top6Domains = qualifying.slice(0, 6);
  const top3Industries: IndustryRollup[] = qualifying.slice(0, 3).map((d) => ({
    cluster: d.cluster,
    industry: d.industry,
    domain: d.domain,
    fitScore: d.fitScore,
    level: d.level,
    meaning: d.meaning,
  }));

  return { rankedDomains, top6Domains, top3Industries };
}

// Numeric rank for an AI-resilience grade (higher = more resilient). Shared with the
// service so the representative-career tiebreak matches the DomainUnit ranking.
export function aiResilienceRank(grade: string | null | undefined): number {
  switch (grade) {
    case "VERY_HIGH":
      return 4;
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}
