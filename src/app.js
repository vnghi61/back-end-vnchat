import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import fs from "fs";
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
import docsRoutes from "./routes/docs.route.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

// Bảng mount duy nhất – test/openapi.test.js dùng bảng này để đối chiếu api/openapi.yaml với route thật.
export const API_ROUTERS = [
  ["/api/auth", authRoutes],
  ["/api/messages", messageRoutes],
  ["/api/conversations", conversationRoutes],
  ["/api/polls", pollRoutes],
  ["/api/reminders", reminderRoutes],
  ["/api/support", supportRoutes],
  ["/api/widget", widgetRouter],
  ["/api/admin", adminRoutes],
  ["/api/open/v1", openRoutes],
  ["/api", userRoutes],
];

// TRUST_PROXY: số hop ("1"), true/false, hoặc danh sách IP/CIDR ("10.0.0.0/8") – để req.ip là IP thật của client.
const trustProxy = (value) => {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
};

export function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY) app.set("trust proxy", trustProxy(process.env.TRUST_PROXY));

  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    })
  );

  app.get("/health", (req, res) => res.json({ status: "ok", version: config.version }));
  app.get("/health/ready", (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "degraded", checks: { mongo: ready } });
  });

  if (config.apiDocsEnabled) app.use("/api-docs", docsRoutes);

  for (const [prefix, router] of API_ROUTERS) app.use(prefix, router);
  app.use("/api", notFoundHandler);

  // Phục vụ frontend build chung process (tuỳ chọn): chỉ khi thư mục dist tồn tại.
  const dist = path.resolve(config.frontendDist);
  if (config.env === "production" && fs.existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist));

    // Express 5: wildcard phải đặt tên
    app.get("/{*splat}", (req, res) => {
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
