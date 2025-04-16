import express from "express";
import { getUser, getMessages, sendMessages} from "../controller/message.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
const router = express.Router();


router.get("/users", protectRoute, getUser);

router.get("/:id", protectRoute, getMessages);

router.get("send/:id", protectRoute, sendMessages);


export default router