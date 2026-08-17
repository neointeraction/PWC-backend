import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireAuth, requireAdmin } from "../../common/middlewares/auth.js";
import * as controller from "./career-taxonomy.controller.js";
import {
  createClusterSchema,
  createDomainSchema,
  createIndustrySchema,
  listClustersQuerySchema,
  listDomainsQuerySchema,
  listIndustriesQuerySchema,
  taxonomyIdParamsSchema,
  updateClusterSchema,
  updateDomainSchema,
  updateIndustrySchema,
} from "./career-taxonomy.schema.js";

// Admin-managed career taxonomy: Cluster → Industry → Domain (3-level hierarchy). Reads are open
// to any authenticated user (students/counsellors see the pickers); writes are admin-only.
// Soft-delete via DELETE, reverse via POST /:id/restore. Each entity has its own path prefix, so
// there's no shared "/:id" catch-all ordering concern.
export const careerTaxonomyRouter = Router();

// Cascading-picker source for the "add job role" form.
careerTaxonomyRouter.get("/tree", ...requireAuth, asyncHandler(controller.getTree));

// --- Clusters ---
careerTaxonomyRouter.get(
  "/clusters",
  ...requireAuth,
  validate({ query: listClustersQuerySchema }),
  asyncHandler(controller.listClusters)
);
careerTaxonomyRouter.post(
  "/clusters",
  ...requireAdmin,
  validate({ body: createClusterSchema }),
  asyncHandler(controller.createCluster)
);
careerTaxonomyRouter.patch(
  "/clusters/:id",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema, body: updateClusterSchema }),
  asyncHandler(controller.updateCluster)
);
careerTaxonomyRouter.delete(
  "/clusters/:id",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema }),
  asyncHandler(controller.deleteCluster)
);
careerTaxonomyRouter.post(
  "/clusters/:id/restore",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema }),
  asyncHandler(controller.restoreCluster)
);

// --- Industries ---
careerTaxonomyRouter.get(
  "/industries",
  ...requireAuth,
  validate({ query: listIndustriesQuerySchema }),
  asyncHandler(controller.listIndustries)
);
careerTaxonomyRouter.post(
  "/industries",
  ...requireAdmin,
  validate({ body: createIndustrySchema }),
  asyncHandler(controller.createIndustry)
);
careerTaxonomyRouter.patch(
  "/industries/:id",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema, body: updateIndustrySchema }),
  asyncHandler(controller.updateIndustry)
);
careerTaxonomyRouter.delete(
  "/industries/:id",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema }),
  asyncHandler(controller.deleteIndustry)
);
careerTaxonomyRouter.post(
  "/industries/:id/restore",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema }),
  asyncHandler(controller.restoreIndustry)
);

// --- Domains ---
careerTaxonomyRouter.get(
  "/domains",
  ...requireAuth,
  validate({ query: listDomainsQuerySchema }),
  asyncHandler(controller.listDomains)
);
careerTaxonomyRouter.post(
  "/domains",
  ...requireAdmin,
  validate({ body: createDomainSchema }),
  asyncHandler(controller.createDomain)
);
careerTaxonomyRouter.patch(
  "/domains/:id",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema, body: updateDomainSchema }),
  asyncHandler(controller.updateDomain)
);
careerTaxonomyRouter.delete(
  "/domains/:id",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema }),
  asyncHandler(controller.deleteDomain)
);
careerTaxonomyRouter.post(
  "/domains/:id/restore",
  ...requireAdmin,
  validate({ params: taxonomyIdParamsSchema }),
  asyncHandler(controller.restoreDomain)
);
