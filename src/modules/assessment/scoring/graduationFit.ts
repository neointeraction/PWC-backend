// Graduation Pathways (report p.9): the same weighted-fit method as Stream Fit and
// Career Fit, applied to the 72 graduation options in the Graduate_Streams sheet (each
// with a weighted top-5 of the 18 traits, summing to 100). The report shows the top 3.
//
// Note: the Assessment Tool Construct doc specifies the Stream and Career formulas but
// not a Graduation-Pathways one explicitly; the Graduate_Streams sheet carries the same
// weight structure, so we apply the identical method (confirmed with PWC).

import { graduateStreams } from "./data/graduate-streams.js";
import { FIT_BANDS, FIT_QUALIFYING_MIN } from "./config.js";
import { weightedFit, type TraitScoreMap } from "./fit.js";
import { gradeByFloor } from "./grading.js";

export interface GraduationFit {
  clusterHead: string | null;
  mainStream: string;
  subStream: string;
  specialisations: string | null;
  eligibility: string | null;
  keyExams: string | null;
  explanation: string | null;
  fitScore: number;
  level: string;
  meaning: string;
}

export interface GraduationFitResult {
  ranked: GraduationFit[];
  top3: GraduationFit[]; // best qualifying (>= FIT_QUALIFYING_MIN) options, up to 3
}

export function scoreGraduationPathways(profile: TraitScoreMap): GraduationFitResult {
  const ranked = graduateStreams
    .map((g): GraduationFit => {
      const fitScore = weightedFit(g.weights, profile);
      const { level, meaning } = gradeByFloor(fitScore, FIT_BANDS);
      return {
        clusterHead: g.clusterHead,
        mainStream: g.mainStream,
        subStream: g.subStream,
        specialisations: g.specialisations,
        eligibility: g.eligibility,
        keyExams: g.keyExams,
        explanation: g.explanation,
        fitScore,
        level,
        meaning,
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore || a.subStream.localeCompare(b.subStream));

  // Only recommend options meeting the required Fit Score (Construct PDF) — fewer than 3
  // if that's all that qualifies.
  const top3 = ranked.filter((g) => g.fitScore >= FIT_QUALIFYING_MIN).slice(0, 3);
  return { ranked, top3 };
}
