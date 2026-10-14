import express from "express";
import { protectRoute, requireUser } from "../middleware/auth.middleware.js";
import { getMessages, getUsersForSidebar, searchMessages, sendMessage } from "../controller/message.controller.js";
import { messageLimiter } from "../middleware/limiters.js";

const router = express.Router();

router.get("/users", protectRoute, requireUser, getUsersForSidebar);
// đặt trước "/:id"
router.get("/search", protectRoute, requireUser, searchMessages);
router.get("/:id", protectRoute, requireUser, getMessages);

router.post("/send/:id", protectRoute, requireUser, messageLimiter, sendMessage);

export default router;
