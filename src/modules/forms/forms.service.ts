import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import type { FormTypeParams, GetFormTemplateQuery } from "./forms.schema.js";

export async function getFormTemplate(
  formType: FormTypeParams["formType"],
  query: GetFormTemplateQuery
) {
  const template = await prisma.formTemplate.findFirst({
    where: {
      formType,
      cohort: query.cohort,
      ...(query.version ? { version: query.version } : { isActive: true }),
    },
    orderBy: { version: "desc" },
    include: {
      questions: { orderBy: { order: "asc" } },
    },
  });

  if (!template) {
    throw new NotFoundError(
      `No ${formType} form found for cohort "${query.cohort}"${
        query.version ? ` version ${query.version}` : ""
      }`
    );
  }

  return template;
}
