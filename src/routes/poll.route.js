import express from "express";
import { closePollHandler, getPoll, putVotes, retractVotes } from "../controller/poll.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/:id", protectRoute, getPoll);
router.put("/:id/votes", protectRoute, putVotes);
router.delete("/:id/votes", protectRoute, retractVotes);
router.post("/:id/close", protectRoute, closePollHandler);

export default router;
