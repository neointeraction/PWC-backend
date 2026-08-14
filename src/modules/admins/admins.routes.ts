import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import { validate } from "../../common/middlewares/validate.js";
import { requireSuperAdmin } from "../../common/middlewares/auth.js";
import * as adminsController from "./admins.controller.js";
import {
  adminIdParamsSchema,
  createAdminSchema,
  listAdminsQuerySchema,
  updateAdminSchema,
} from "./admins.schema.js";

export const adminsRouter = Router();

// App Admin account management — SUPER_ADMIN only (managing admins is above admin level).
adminsRouter.post(
  "/",
  ...requireSuperAdmin,
  validate({ body: createAdminSchema }),
  asyncHandler(adminsController.createAdmin)
);

adminsRouter.get(
  "/",
  ...requireSuperAdmin,
  validate({ query: listAdminsQuerySchema }),
  asyncHandler(adminsController.listAdmins)
);

adminsRouter.get(
  "/:id",
  ...requireSuperAdmin,
  validate({ params: adminIdParamsSchema }),
  asyncHandler(adminsController.getAdmin)
);

adminsRouter.patch(
  "/:id",
  ...requireSuperAdmin,
  validate({ params: adminIdParamsSchema, body: updateAdminSchema }),
  asyncHandler(adminsController.updateAdmin)
);

adminsRouter.delete(
  "/:id",
  ...requireSuperAdmin,
  validate({ params: adminIdParamsSchema }),
  asyncHandler(adminsController.deleteAdmin)
);
