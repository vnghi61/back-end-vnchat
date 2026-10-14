import express from "express";
import {
  openCloseSupport,
  openGetConversation,
  openListMessages,
  openPostMessage,
} from "../controller/open.controller.js";
import { requireApiKey } from "../middleware/apikey.middleware.js";

const router = express.Router();

router.get("/conversations/:id", requireApiKey("conversations:read"), openGetConversation);
router.get("/conversations/:id/messages", requireApiKey("messages:read"), openListMessages);
router.post("/conversations/:id/messages", requireApiKey("messages:write"), openPostMessage);
router.post("/support/conversations/:id/close", requireApiKey("support:write"), openCloseSupport);

export default router;
