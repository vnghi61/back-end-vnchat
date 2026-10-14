import express from "express";
import {
    checkAuth,
    deleteSession,
    listSessions,
    login,
    logout,
    logoutAll,
    signup,
    updateProfile,
} from "../controller/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { config } from "../config.js";
const router = express.Router();

const authLimiter = rateLimit({ limit: config.rateLimit.loginPerMinute, key: (req) => `auth:${req.ip}` });

router.post("/signup", authLimiter, signup);

router.post("/login", authLimiter, login);

router.post("/logout", logout);

router.post("/logout-all", protectRoute, logoutAll);

router.get("/sessions", protectRoute, listSessions);

router.delete("/sessions/:id", protectRoute, deleteSession);

router.put("/update-profile", protectRoute, updateProfile);

router.get("/check", protectRoute, checkAuth);

export default router
