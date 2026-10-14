import express from "express";
import {
  createApiKey,
  createWebhook,
  deleteWebhook,
  getPolicies,
  getSettingsHandler,
  listApiKeys,
  listAudit,
  listDeliveries,
  listUsers,
  listWebhooks,
  redeliverHandler,
  revokeApiKey,
  updatePolicies,
  updateSettingsHandler,
  updateUserRoles,
  updateUserStatus,
  updateWebhook,
} from "../controller/admin.controller.js";
import { authorize, protectRoute, requireUser } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(protectRoute, requireUser);

router.get("/users", authorize("admin:principals", "read"), listUsers);
router.put("/users/:id/roles", authorize("admin:principals", "write"), updateUserRoles);
router.put("/users/:id/status", authorize("admin:principals", "write"), updateUserStatus);

router.get("/webhooks", authorize("admin:webhooks", "read"), listWebhooks);
router.post("/webhooks", authorize("admin:webhooks", "write"), createWebhook);
router.put("/webhooks/:id", authorize("admin:webhooks", "write"), updateWebhook);
router.delete("/webhooks/:id", authorize("admin:webhooks", "write"), deleteWebhook);
router.get("/webhooks/:id/deliveries", authorize("admin:webhooks", "read"), listDeliveries);
router.post("/webhooks/deliveries/:deliveryId/redeliver", authorize("admin:webhooks", "write"), redeliverHandler);

router.get("/settings", authorize("admin:settings", "read"), getSettingsHandler);
router.put("/settings", authorize("admin:settings", "write"), updateSettingsHandler);

router.get("/audit", authorize("admin:audit", "read"), listAudit);

router.get("/api-keys", authorize("admin:api_keys", "read"), listApiKeys);
router.post("/api-keys", authorize("admin:api_keys", "write"), createApiKey);
router.delete("/api-keys/:id", authorize("admin:api_keys", "write"), revokeApiKey);

router.get("/policies", authorize("admin:policies", "read"), getPolicies);
router.put("/policies", authorize("admin:policies", "write"), updatePolicies);

export default router;
