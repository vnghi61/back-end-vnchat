import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import mongoose from "mongoose";
import path from "path";

import { config } from "./config.js";
import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import conversationRoutes from "./routes/conversation.route.js";
import pollRoutes from "./routes/poll.route.js";
import reminderRoutes from "./routes/reminder.route.js";
import supportRoutes, { widgetRouter } from "./routes/support.route.js";
import adminRoutes from "./routes/admin.route.js";
import openRoutes from "./routes/open.route.js";
import userRoutes from "./routes/user.route.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

export function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    })
  );

  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "degraded", checks: { mongo: ready } });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/polls", pollRoutes);
  app.use("/api/reminders", reminderRoutes);
  app.use("/api/support", supportRoutes);
  app.use("/api/widget", widgetRouter);
  app.use("/api/admin", adminRoutes);
  app.use("/api/open/v1", openRoutes);
  app.use("/api", userRoutes);
  app.use("/api", notFoundHandler);

  if (config.env === "production") {
    const __dirname = path.resolve();
    app.use(express.static(path.join(__dirname, "../frontend/dist")));

    // Express 5: wildcard phải đặt tên
    app.get("/{*splat}", (req, res) => {
      res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
