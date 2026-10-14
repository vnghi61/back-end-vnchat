import express from "express";
import {
  addMembers,
  archiveConversation,
  createDirect,
  createGroup,
  getConversation,
  leaveConversation,
  listConversations,
  listMembers,
  markRead,
  muteConversation,
  pinConversation,
  removeMember,
  updateConversation,
  updateMemberRole,
} from "../controller/conversation.controller.js";
import {
  addReaction,
  deleteMessage,
  editMessage,
  forwardMessage,
  getMessage,
  hideMessage,
  listMedia,
  listMessages,
  listPins,
  pinMessage,
  removeReaction,
  sendToConversation,
  typing,
  unhideMessage,
  unpinMessage,
} from "../controller/message.controller.js";
import { createPoll } from "../controller/poll.controller.js";
import { authorize, protectRoute, requireUser } from "../middleware/auth.middleware.js";
import { messageLimiter } from "../middleware/limiters.js";

const router = express.Router();
const staff = [protectRoute, requireUser, authorize("chat", "write")];

router.get("/", protectRoute, listConversations);
router.post("/direct", ...staff, createDirect);
router.post("/group", ...staff, createGroup);
router.get("/:id", protectRoute, getConversation);
router.patch("/:id", ...staff, updateConversation);

router.get("/:id/members", protectRoute, listMembers);
router.post("/:id/members", ...staff, addMembers);
router.delete("/:id/members/:userId", ...staff, removeMember);
router.patch("/:id/members/:userId", ...staff, updateMemberRole);
router.post("/:id/leave", protectRoute, leaveConversation);

router.post("/:id/read", protectRoute, markRead);
router.post("/:id/mute", protectRoute, muteConversation);
router.post("/:id/archive", protectRoute, archiveConversation);
router.post("/:id/pin", protectRoute, pinConversation);
router.post("/:id/typing", protectRoute, typing);

router.get("/:id/messages", protectRoute, listMessages);
router.post("/:id/messages", protectRoute, messageLimiter, sendToConversation);
router.get("/:id/messages/:messageId", protectRoute, getMessage);
router.patch("/:id/messages/:messageId", protectRoute, editMessage);
router.delete("/:id/messages/:messageId", protectRoute, deleteMessage);
router.post("/:id/messages/:messageId/reactions", protectRoute, addReaction);
router.delete("/:id/messages/:messageId/reactions/:emoji", protectRoute, removeReaction);
router.post("/:id/messages/:messageId/pin", protectRoute, pinMessage);
router.delete("/:id/messages/:messageId/pin", protectRoute, unpinMessage);
router.post("/:id/messages/:messageId/hide", protectRoute, hideMessage);
router.delete("/:id/messages/:messageId/hide", protectRoute, unhideMessage);
router.post("/:id/messages/:messageId/forward", protectRoute, requireUser, messageLimiter, forwardMessage);

router.get("/:id/pins", protectRoute, listPins);
router.get("/:id/media", protectRoute, listMedia);
router.post("/:id/polls", protectRoute, requireUser, messageLimiter, createPoll);

export default router;
