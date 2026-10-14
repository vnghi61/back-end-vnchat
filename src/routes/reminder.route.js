import express from "express";
import {
  cancelReminder,
  createReminder,
  getReminder,
  listReminders,
  updateReminder,
} from "../controller/reminder.controller.js";
import { protectRoute, requireUser } from "../middleware/auth.middleware.js";

const router = express.Router();
const auth = [protectRoute, requireUser];

router.post("/", ...auth, createReminder);
router.get("/", ...auth, listReminders);
router.get("/:id", ...auth, getReminder);
router.patch("/:id", ...auth, updateReminder);
router.delete("/:id", ...auth, cancelReminder);

export default router;
