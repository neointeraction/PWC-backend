// Types for the generated scoring reference data (./*.ts, produced by
// scripts/export-assessment-scoring.py from the Traits & Weightages workbook).

import type { TraitKey } from "../types.js";

export interface TraitDefinition {
  layer: string;
  key: TraitKey;
  trait: string; // workbook trait label, e.g. "Numerical Reasoning"
  traitName: string; // report-facing name, e.g. "Computational Thinking"
  description: string;
}

export interface Riasec120Entry {
  code: string; // 3-letter, e.g. "RIA"
  traits: TraitKey[]; // the three traits in rank order
  style: string; // Dominant Career Style
  description: string;
  explanation: string; // student & parent-friendly
}

export interface BigFive20Entry {
  code: string; // 2-letter with hyphen, e.g. "O-C"
  style: string; // Personality Style
  description: string;
  explanation: string;
}

export interface StreamWeightEntry {
  mainStream: string;
  subStream: string;
  coreSubjects: string | null;
  electiveSubjects: string | null;
  explanation: string | null;
  weights: Partial<Record<TraitKey, number>>; // 5 traits, sum to 100
}

export interface DomainWeightEntry {
  cluster: string;
  industry: string;
  domain: string; // "All Domains" (industry-wide) or a specific domain name
  weightSum: number; // 100 for most; a few specific-domain rows sum to 85-95
  explanation: string | null;
  weights: Partial<Record<TraitKey, number>>;
}

export interface GraduateStreamEntry {
  clusterHead: string | null;
  mainStream: string;
  subStream: string;
  specialisations: string | null;
  eligibility: string | null; // eligibility from Class 12
  keyExams: string | null;
  explanation: string | null;
  weights: Partial<Record<TraitKey, number>>; // 5 traits, sum to 100
}
