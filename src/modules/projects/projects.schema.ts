import { z } from "zod";

// Writable statuses (create/update). DELETED is set/cleared only via the DELETE + restore
// endpoints, never by an arbitrary PATCH, so it's intentionally excluded here.
export const projectStatusSchema = z.enum(["ACTIVE", "CLOSED"]);

// Filter statuses for listing — includes DELETED so the UI can list soft-deleted projects.
export const projectStatusFilterSchema = z.enum(["ACTIVE", "CLOSED", "DELETED"]);

export const createProjectSchema = z
  .object({
    instituteId: z.string().cuid(),
    name: z.string().trim().min(1),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date(),
    status: projectStatusSchema.optional(),
  })
  .refine((d) => d.fromDate <= d.toDate, {
    message: "fromDate must be on or before toDate",
    path: ["toDate"],
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// Date order is validated in the service (needs the merge with the existing row when only
// one of the two dates is supplied), not here.
export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  status: projectStatusSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export const listProjectsQuerySchema = z.object({
  instituteId: z.string().cuid().optional(),
  // No status → active + closed (excludes DELETED). `status=DELETED` lists only soft-deleted.
  status: projectStatusFilterSchema.optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
