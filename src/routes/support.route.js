import express from "express";
import { widgetSession } from "../controller/auth.controller.js";
import {
  assignSupport,
  closeSupportHandler,
  listAgents,
  mySupportConversations,
  rateSupport,
  releaseSupport,
  reopenSupportHandler,
  setSupportTags,
  startSupport,
  supportQueue,
  supportStats,
  transferSupport,
} from "../controller/support.controller.js";
import { authorize, protectRoute, requireUser } from "../middleware/auth.middleware.js";
import { widgetLimiter } from "../middleware/limiters.js";

const router = express.Router();
const agent = [protectRoute, requireUser, authorize("support", "write")];

// phía khách (tài khoản đăng ký hoặc khách widget)
router.post("/conversations", protectRoute, startSupport);
router.get("/conversations/mine", protectRoute, mySupportConversations);
router.post("/conversations/:id/rate", protectRoute, rateSupport);
router.post("/conversations/:id/close", protectRoute, closeSupportHandler);

// phía nhân viên hỗ trợ (role agent/admin)
router.get("/queue", ...agent, supportQueue);
router.get("/stats", ...agent, supportStats);
router.get("/agents", ...agent, listAgents);
router.post("/conversations/:id/assign", ...agent, assignSupport);
router.post("/conversations/:id/transfer", ...agent, transferSupport);
router.post("/conversations/:id/release", ...agent, releaseSupport);
router.post("/conversations/:id/reopen", ...agent, reopenSupportHandler);
router.put("/conversations/:id/tags", ...agent, setSupportTags);

export const widgetRouter = express.Router();
widgetRouter.post("/sessions", widgetLimiter, widgetSession);

export default router;
