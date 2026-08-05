import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  classIdParamsSchema,
  createInstituteClassSchema,
  createInstituteDivisionSchema,
  createInstituteSchema,
  instituteIdParamsSchema,
  updateInstituteSchema,
} from "../modules/institutes/institutes.schema.js";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdParamsSchema,
  updateStudentSchema,
} from "../modules/students/students.schema.js";
import { formTypeParamsSchema, getFormTemplateQuerySchema } from "../modules/forms/forms.schema.js";
import { listAssessmentQuestionsQuerySchema } from "../modules/assessment/assessment.schema.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const genericObjectSchema = z.object({}).passthrough();

const errorResponses = {
  400: { description: "Validation error", content: { "application/json": { schema: errorResponseSchema } } },
  404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  409: { description: "Conflict (duplicate unique field)", content: { "application/json": { schema: errorResponseSchema } } },
};

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Liveness check",
  responses: {
    200: {
      description: "Service is up",
      content: { "application/json": { schema: z.object({ status: z.literal("ok"), timestamp: z.string() }) } },
    },
  },
});

// --- Institutes ---

registry.registerPath({
  method: "post",
  path: "/api/v1/institutes",
  tags: ["Institutes"],
  summary: "Create an institute",
  request: { body: { content: { "application/json": { schema: createInstituteSchema } } } },
  responses: {
    201: { description: "Institute created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes",
  tags: ["Institutes"],
  summary: "List institutes",
  responses: {
    200: { description: "List of institutes", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes/{id}",
  tags: ["Institutes"],
  summary: "Get an institute by id",
  request: { params: instituteIdParamsSchema },
  responses: {
    200: { description: "Institute", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/institutes/{id}",
  tags: ["Institutes"],
  summary: "Update an institute",
  request: {
    params: instituteIdParamsSchema,
    body: { content: { "application/json": { schema: updateInstituteSchema } } },
  },
  responses: {
    200: { description: "Updated institute", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/institutes/{id}",
  tags: ["Institutes"],
  summary: "Delete an institute",
  request: { params: instituteIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/institutes/{id}/classes",
  tags: ["Institutes"],
  summary: "Create a class under an institute",
  request: {
    params: instituteIdParamsSchema,
    body: { content: { "application/json": { schema: createInstituteClassSchema } } },
  },
  responses: {
    201: { description: "Class created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes/{id}/classes",
  tags: ["Institutes"],
  summary: "List classes under an institute",
  request: { params: instituteIdParamsSchema },
  responses: {
    200: { description: "List of classes", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/institutes/{id}/classes/{classId}/divisions",
  tags: ["Institutes"],
  summary: "Create a division under a class",
  request: {
    params: classIdParamsSchema,
    body: { content: { "application/json": { schema: createInstituteDivisionSchema } } },
  },
  responses: {
    201: { description: "Division created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes/{id}/classes/{classId}/divisions",
  tags: ["Institutes"],
  summary: "List divisions under a class",
  request: { params: classIdParamsSchema },
  responses: {
    200: { description: "List of divisions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    404: errorResponses[404],
  },
});

// --- Students ---

registry.registerPath({
  method: "post",
  path: "/api/v1/students",
  tags: ["Students"],
  summary: "Create a student (also creates a linked User with role STUDENT)",
  request: { body: { content: { "application/json": { schema: createStudentSchema } } } },
  responses: {
    201: {
      description: "Student created. Response includes a one-time tempPassword for the linked user account.",
      content: { "application/json": { schema: genericObjectSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/students",
  tags: ["Students"],
  summary: "List students",
  request: { query: listStudentsQuerySchema },
  responses: {
    200: { description: "List of students", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/students/{id}",
  tags: ["Students"],
  summary: "Get a student by id",
  request: { params: studentIdParamsSchema },
  responses: {
    200: { description: "Student", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/students/{id}",
  tags: ["Students"],
  summary: "Update a student",
  request: {
    params: studentIdParamsSchema,
    body: { content: { "application/json": { schema: updateStudentSchema } } },
  },
  responses: {
    200: { description: "Updated student", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/students/{id}",
  tags: ["Students"],
  summary: "Delete a student (deletes the linked User too)",
  request: { params: studentIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    404: errorResponses[404],
  },
});

// --- Forms ---

registry.registerPath({
  method: "get",
  path: "/api/v1/forms/{formType}",
  tags: ["Forms"],
  summary: "Get a form template with its ordered questions",
  request: { params: formTypeParamsSchema, query: getFormTemplateQuerySchema },
  responses: {
    200: { description: "Form template with questions", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- Assessment ---

registry.registerPath({
  method: "get",
  path: "/api/v1/assessment/questions",
  tags: ["Assessment"],
  summary: "List assessment questions for a cohort (correctOption is never included in the response)",
  request: { query: listAssessmentQuestionsQuerySchema },
  responses: {
    200: { description: "List of assessment questions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    ...errorResponses,
  },
});

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Counselling Platform API",
      version: "0.1.0",
      description: "API for the counselling platform (students, institutes, auth, forms, sessions).",
    },
    servers: [{ url: "/" }],
  });
}
