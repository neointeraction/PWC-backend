import type { WorkflowStatus } from "@prisma/client";
import { z } from "zod";
import { emailSchema, phoneSchema } from "../../common/validators/shared.js";
import { WORKFLOW_STATUS_ORDER } from "../../common/workflow/workflowStatus.js";
import { DERIVED_STAGES } from "./studentStage.js";

export const workflowStatusSchema = z.enum(
  WORKFLOW_STATUS_ORDER as [WorkflowStatus, ...WorkflowStatus[]]
);

export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: emailSchema,
  mobile: phoneSchema,
  whatsappNumber: phoneSchema.optional(),
  // Admin-supplied human-readable login id (e.g. "S0001"). Required — no longer generated
  // by the service.
  studentCode: z.string().trim().min(1),
  password: z.string().min(1).optional(), // temp password from the import sheet; generated if omitted
  projectId: z.string().cuid(),
  divisionId: z.string().cuid(),
  parentMobile: phoneSchema,
  parentEmail: emailSchema,
  // Parent/guardian breakdown is optional — bulk imports may carry only a single
  // "parent" contact. Stored as "" when omitted (columns are NOT NULL).
  fatherName: z.string().trim().min(1).optional(),
  fatherOccupation: z.string().trim().min(1).optional(),
  fatherEmployer: z.string().trim().min(1).optional(),
  motherName: z.string().trim().min(1).optional(),
  motherOccupation: z.string().trim().min(1).optional(),
  motherEmployer: z.string().trim().min(1).optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  mobile: phoneSchema.optional(),
  whatsappNumber: phoneSchema.optional(),
  divisionId: z.string().cuid().optional(),
  parentMobile: phoneSchema.optional(),
  parentEmail: emailSchema.optional(),
  fatherName: z.string().trim().min(1).optional(),
  fatherOccupation: z.string().trim().min(1).optional(),
  fatherEmployer: z.string().trim().min(1).optional(),
  motherName: z.string().trim().min(1).optional(),
  motherOccupation: z.string().trim().min(1).optional(),
  motherEmployer: z.string().trim().min(1).optional(),
});
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

// Student self-service edit (PATCH /students/me). Deliberately a narrower field set than
// the admin `updateStudentSchema`: identity/enrolment fields a student must NOT change —
// name, primary mobile, email, studentCode, division, project, workflowStatus — are
// omitted. What's left is the parent/guardian block plus the student's own WhatsApp
// number, i.e. the "extra details" a student fills in and keeps up to date themselves.
export const updateMyStudentSchema = z.object({
  whatsappNumber: phoneSchema.optional(),
  parentMobile: phoneSchema.optional(),
  parentEmail: emailSchema.optional(),
  fatherName: z.string().trim().min(1).optional(),
  fatherOccupation: z.string().trim().min(1).optional(),
  fatherEmployer: z.string().trim().min(1).optional(),
  motherName: z.string().trim().min(1).optional(),
  motherOccupation: z.string().trim().min(1).optional(),
  motherEmployer: z.string().trim().min(1).optional(),
});
export type UpdateMyStudentInput = z.infer<typeof updateMyStudentSchema>;

export const studentIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listStudentsQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  divisionId: z.string().cuid().optional(),
  workflowStatus: workflowStatusSchema.optional(),
  // Derived-stage dropdown (the "All Stages" filter) — finer-grained than workflowStatus.
  stage: z.enum(DERIVED_STAGES).optional(),
  // 🚩 toolbar toggle: `flagged=true` → only students needing follow-up. Query params are
  // strings, so accept the literal "true"/"false" (z.coerce.boolean treats "false" as true).
  flagged: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // `?discontinued=false` → active only (the default follow-up list); `=true` → only
  // discontinued students. Omitted → no filtering, same as today.
  discontinued: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;

export const updateWorkflowStatusBodySchema = z.object({
  workflowStatus: workflowStatusSchema,
});
export type UpdateWorkflowStatusBody = z.infer<typeof updateWorkflowStatusBodySchema>;

export const discontinueStudentBodySchema = z.object({
  reason: z.string().trim().min(1).optional(),
});
export type DiscontinueStudentBody = z.infer<typeof discontinueStudentBodySchema>;
