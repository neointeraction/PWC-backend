import type {
  AssessmentDifficulty,
  AssessmentQuestionFormat,
  AssessmentSection,
  QuestionType,
} from "@prisma/client";

export interface FormQuestionSeed {
  order: number;
  questionCode: string;
  fieldKey: string;
  sectionLabel?: string;
  questionText: string;
  helpText?: string;
  questionType: QuestionType;
  options?: unknown;
  allowOtherText?: boolean;
  otherTextFieldKey?: string;
  isRequired?: boolean;
}

export interface AssessmentQuestionSeed {
  section: AssessmentSection;
  order: number; // logical/grouped order (RIASEC 1-24, Big Five 25-44, ...)
  displayOrder: number; // presentation position shown to the student (interleaved)
  questionCode: string;
  fieldKey: string;
  questionText: string;
  format: AssessmentQuestionFormat;
  options?: unknown;
  trait: string;
  traitCode?: string;
  difficulty?: AssessmentDifficulty;
  weight?: number;
  correctOption?: string;
}
