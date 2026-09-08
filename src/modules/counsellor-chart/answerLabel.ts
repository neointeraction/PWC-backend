// Resolves a raw FormAnswer.answer value (option keys, as stored) against its
// FormQuestion.options (where the label text lives) so downstream consumers — the
// Counsellor Chart today — see human-readable labels instead of codes like "b" or
// "not_really". Shape-preserving: only leaf option values are swapped for labels.

interface OptionDef {
  value: string;
  label: string;
}

interface MatrixFieldDef {
  key: string;
  type: string;
  options?: unknown;
  allowOtherText?: boolean;
}

interface MatrixOptions {
  rows?: Array<{ key: string }>;
  fields?: MatrixFieldDef[];
}

interface QuestionLike {
  questionType: string;
  options: unknown;
  allowOtherText?: boolean;
}

function resolveOptionValue(options: unknown, value: unknown): unknown {
  if (typeof value !== "string" || !Array.isArray(options)) return value;
  const match = (options as OptionDef[]).find((o) => o?.value === value);
  return match ? match.label : value;
}

// Resolves an MCQ_SINGLE/MCQ_MULTI leaf answer, including the `{ value, other }` shape
// used when the question allows an "Any Other: ___" free-text option.
function resolveMcqAnswer(field: QuestionLike, answer: unknown): unknown {
  if (answer === null || answer === undefined) return answer;

  if (field.allowOtherText && typeof answer === "object" && !Array.isArray(answer)) {
    const { value, ...rest } = answer as Record<string, unknown>;
    const resolvedValue =
      field.questionType === "MCQ_MULTI" && Array.isArray(value)
        ? value.map((v) => resolveOptionValue(field.options, v))
        : resolveOptionValue(field.options, value);
    return { ...rest, value: resolvedValue };
  }

  if (field.questionType === "MCQ_MULTI" && Array.isArray(answer)) {
    return answer.map((v) => resolveOptionValue(field.options, v));
  }

  return resolveOptionValue(field.options, answer);
}

function resolveMatrixRow(fields: MatrixFieldDef[], rowData: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rowData };
  for (const field of fields) {
    if (field.key in rowData && (field.type === "MCQ_SINGLE" || field.type === "MCQ_MULTI")) {
      result[field.key] = resolveMcqAnswer(
        { questionType: field.type, options: field.options, allowOtherText: field.allowOtherText },
        rowData[field.key]
      );
    }
  }
  return result;
}

function resolveMatrixAnswer(options: unknown, answer: unknown): unknown {
  if (!options || typeof options !== "object" || typeof answer !== "object" || answer === null) return answer;
  const { rows, fields } = options as MatrixOptions;
  if (!fields || fields.length === 0) return answer;

  const data = answer as Record<string, unknown>;
  if (!rows || rows.length === 0) {
    return resolveMatrixRow(fields, data);
  }

  const result: Record<string, unknown> = { ...data };
  for (const row of rows) {
    const rowData = data[row.key];
    if (rowData && typeof rowData === "object") {
      result[row.key] = resolveMatrixRow(fields, rowData as Record<string, unknown>);
    }
  }
  return result;
}

// Resolves a stored FormAnswer.answer into option label(s), given the FormQuestion it
// belongs to. Non-choice question types (SHORT_TEXT, OPEN_TEXT, NUMBER, SCALE) are
// passed through unchanged.
export function resolveAnswerLabels(question: QuestionLike, answer: unknown): unknown {
  if (answer === null || answer === undefined) return answer;

  if (question.questionType === "MATRIX") {
    return resolveMatrixAnswer(question.options, answer);
  }

  if (question.questionType === "MCQ_SINGLE" || question.questionType === "MCQ_MULTI") {
    return resolveMcqAnswer(question, answer);
  }

  return answer;
}
